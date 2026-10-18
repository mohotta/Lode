import { BrowserWindow, app, net } from 'electron';
import { z } from 'zod';
import { atomicWrite } from '@core/fs/atomicWrite';
import { readTextOrNull } from '@core/fs/readText';
import { GenerationCancelled, GenerationService, type GenerationReport } from '@core/generation/GenerationService';
import { JobQueue } from '@core/generation/JobQueue';
import { periodRange } from '@core/formats/period';
import { OpenAiCompatibleAdapter } from '@core/llm/openaiCompatible';
import { TavilySearch } from '@core/llm/tavily';
import { LODE_DIR } from '@core/repos/Vault';
import type { PreviewView } from '@shared/ipc';
import type { KeyStore } from '../KeyStore';
import type { SettingsStore } from '../SettingsStore';
import type { OpenVault, VaultRegistry } from '../VaultRegistry';
import { handle } from './handle';

// Test-only endpoint override (e2e fake Tavily). Ignored in packaged builds.
const TAVILY_URL = !app.isPackaged ? process.env.LODE_TAVILY_URL : undefined;

const RunLog = z.array(z.unknown());

async function logRun(
  v: OpenVault,
  folder: string,
  model: string,
  report: GenerationReport,
  kind: 'generate' | 'regenerate' | 'digest',
): Promise<void> {
  // Local usage log (PRD cost transparency). Counts only: no point text, no keys.
  const path = await v.vault.path(LODE_DIR, 'runs.json');
  const raw = await readTextOrNull(path);
  let runs: unknown[] = [];
  try {
    runs = raw ? RunLog.parse(JSON.parse(raw)) : [];
  } catch {
    runs = [];
  }
  runs.push({
    at: new Date().toISOString(),
    kind,
    folder,
    model,
    usage: report.usage,
    filed: report.filed.length,
    unfiled: report.unfiled.length,
    subtopics: report.changed.map((c) => c.slug),
    corrected: report.corrected.length,
    duplicates: report.duplicates.length,
    // Generic pipeline messages only (counts and subtopic titles); never point text.
    warnings: report.warnings,
  });
  await v.vault.locks.run(path, () => atomicWrite(path, JSON.stringify(runs.slice(-500), null, 2) + '\n'));
}

export function registerGenerateHandlers(registry: VaultRegistry, settings: SettingsStore, keys: KeyStore): void {
  async function build(v: OpenVault): Promise<{ gen: GenerationService; blocker: string | null; model: string; baseUrl: string }> {
    const s = await settings.get();
    const hasTavily = await keys.has('tavily');
    const search =
      s.generation.useSearch && hasTavily
        ? new TavilySearch({ getKey: () => keys.get('tavily'), ...(TAVILY_URL ? { endpoint: TAVILY_URL } : {}) })
        : undefined;
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: s.llm.baseUrl,
      model: s.llm.model || 'unset',
      getKey: () => keys.get('llm'),
      ...(search ? { search } : {}),
    });
    const gen = new GenerationService({
      // Invariant 1: generation receives the read-only backlog view and the notes repo only.
      backlog: v.backlog.asReadonly((folder) => v.notes.filing(folder)),
      notes: v.notes,
      digests: v.digests,
      adapter,
      settings: { ...s.generation, useSearch: s.generation.useSearch && hasTavily },
    });
    let blocker: string | null = null;
    if (!s.llm.model) blocker = 'Choose a model in Settings first.';
    else if (!net.isOnline()) blocker = 'You appear to be offline. Capture still works; Generate needs a connection.';
    return { gen, blocker, model: s.llm.model, baseUrl: s.llm.baseUrl };
  }

  async function folderTitle(v: OpenVault, folder: string): Promise<string> {
    return (await v.service.listFolders()).find((f) => f.slug === folder)?.title ?? folder;
  }

  const OVER_CAP = 'This run exceeds the token ceiling in Settings. Raise it or generate in smaller batches.';

  // Jobs run in the background, one at a time; the renderer follows them through `generate:jobs` events.
  const queue = new JobQueue<GenerationReport>(
    async (spec, signal, onProgress) => {
      const v = await registry.get(spec.vaultId);
      const { gen, blocker, model } = await build(v);
      if (blocker) throw new Error(blocker);
      const title = await folderTitle(v, spec.folder);
      try {
        const { subtopic: sub, digest } = spec;
        const preview = digest
          ? await gen.previewDigest(spec.folder, title, digest)
          : sub
            ? await gen.previewRegenerate(spec.folder, title, sub)
            : await gen.preview(spec.folder, title);
        if (preview.overCap) throw new Error(OVER_CAP);
        const report = digest
          ? await gen.digest(spec.folder, title, digest, signal, onProgress)
          : sub
            ? await gen.regenerate(spec.folder, title, sub, signal, onProgress)
            : await gen.run(spec.folder, title, signal, onProgress);
        await logRun(v, spec.folder, model, report, spec.kind).catch(() => undefined);
        return report;
      } catch (err) {
        if (err instanceof GenerationCancelled) throw err;
        const prefix =
          spec.kind === 'regenerate'
            ? 'Regenerate failed, the note is unchanged.'
            : spec.kind === 'digest'
              ? 'Digest failed, nothing was written.'
              : 'Generation failed, nothing was written.';
        throw new Error(`${prefix} ${err instanceof Error ? err.message : ''}`.trim(), { cause: err });
      }
    },
    (jobs) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('generate:jobs', jobs);
    },
    (err) => err instanceof GenerationCancelled,
  );

  handle('generate:preview', async ({ vaultId, folder, subtopic, digest }): Promise<PreviewView> => {
    const v = await registry.get(vaultId);
    const s = await settings.get();
    const { gen, blocker, model, baseUrl } = await build(v);
    const title = await folderTitle(v, folder);
    const p = digest
      ? await gen.previewDigest(folder, title, digest)
      : subtopic
        ? await gen.previewRegenerate(folder, title, subtopic)
        : await gen.preview(folder, title);
    return {
      ...p,
      kind: digest ? 'digest' : subtopic ? 'regenerate' : 'generate',
      searchUnavailable: s.generation.useSearch && !(await keys.has('tavily')),
      maxInputTokens: s.generation.maxInputTokens,
      provider: 'OpenAI-compatible',
      model,
      baseUrl,
      blocker:
        blocker ??
        (p.points === 0
          ? digest
            ? 'No points in this period.'
            : subtopic
            ? 'This note has no points left to regenerate from.'
            : 'No unfiled points in this folder.'
          : p.overCap
            ? OVER_CAP
            : null),
    };
  });

  handle('generate:enqueue', async ({ vaultId, folder, subtopic, digest }) => {
    const v = await registry.get(vaultId);
    const { blocker } = await build(v);
    if (blocker) throw new Error(blocker);
    const title = await folderTitle(v, folder);
    if (digest) {
      const range = periodRange(digest);
      if (!range) throw new Error('Invalid digest period');
      return queue.enqueue({ vaultId, folder, folderTitle: title, kind: 'digest', digest, digestTitle: range.title });
    }
    const note = subtopic ? await v.notes.read(folder, subtopic) : null;
    if (subtopic && !note) throw new Error('Note not found');
    return queue.enqueue({
      vaultId,
      folder,
      folderTitle: title,
      kind: subtopic ? 'regenerate' : 'generate',
      ...(subtopic && note ? { subtopic, subtopicTitle: note.meta.title } : {}),
    });
  });

  handle('generate:jobs', async () => queue.list());
  handle('generate:cancel', async ({ jobId }) => queue.cancel(jobId));
  handle('generate:dismiss', async ({ jobId }) => queue.dismiss(jobId));
}
