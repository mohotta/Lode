import { BrowserWindow, app, net } from 'electron';
import { z } from 'zod';
import { atomicWrite } from '@core/fs/atomicWrite';
import { readTextOrNull } from '@core/fs/readText';
import { GenerationCancelled, GenerationService, type GenerationReport } from '@core/generation/GenerationService';
import { OpenAiCompatibleAdapter } from '@core/llm/openaiCompatible';
import { TavilySearch } from '@core/llm/tavily';
import { LODE_DIR } from '@core/repos/Vault';
import type { PreviewView, ProgressView } from '@shared/ipc';
import type { KeyStore } from '../KeyStore';
import type { SettingsStore } from '../SettingsStore';
import type { OpenVault, VaultRegistry } from '../VaultRegistry';
import { handle } from './handle';

// Test-only endpoint override (e2e fake Tavily). Ignored in packaged builds.
const TAVILY_URL = !app.isPackaged ? process.env.LODE_TAVILY_URL : undefined;

const RunLog = z.array(z.unknown());

async function logRun(v: OpenVault, folder: string, model: string, report: GenerationReport): Promise<void> {
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
    folder,
    model,
    usage: report.usage,
    filed: report.filed.length,
    unfiled: report.unfiled.length,
    subtopics: report.changed.map((c) => c.slug),
    corrected: report.corrected.length,
    // Generic pipeline messages only (counts and subtopic titles); never point text.
    warnings: report.warnings,
  });
  await v.vault.locks.run(path, () => atomicWrite(path, JSON.stringify(runs.slice(-500), null, 2) + '\n'));
}

export function registerGenerateHandlers(registry: VaultRegistry, settings: SettingsStore, keys: KeyStore): void {
  const running = new Map<string, AbortController>();
  const runKey = (vaultId: string, folder: string): string => `${vaultId}/${folder}`;

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

  handle('generate:preview', async ({ vaultId, folder }): Promise<PreviewView> => {
    const v = await registry.get(vaultId);
    const s = await settings.get();
    const { gen, blocker, model, baseUrl } = await build(v);
    const p = await gen.preview(folder, await folderTitle(v, folder));
    return {
      ...p,
      searchUnavailable: s.generation.useSearch && !(await keys.has('tavily')),
      maxInputTokens: s.generation.maxInputTokens,
      provider: 'OpenAI-compatible',
      model,
      baseUrl,
      blocker:
        blocker ??
        (p.points === 0
          ? 'No unfiled points in this folder.'
          : p.overCap
            ? 'This run exceeds the token ceiling in Settings. Raise it or generate in smaller batches.'
            : null),
    };
  });

  handle('generate:run', async ({ vaultId, folder }) => {
    const key = runKey(vaultId, folder);
    if (running.has(key)) throw new Error('A generation run is already in progress for this folder');
    const v = await registry.get(vaultId);
    const { gen, blocker, model } = await build(v);
    if (blocker) throw new Error(blocker);
    const title = await folderTitle(v, folder);
    if ((await gen.preview(folder, title)).overCap) {
      throw new Error('This run exceeds the token ceiling in Settings. Raise it or generate in smaller batches.');
    }
    const ctrl = new AbortController();
    running.set(key, ctrl);
    const send = (event: ProgressView): void => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('generate:progress', { vaultId, folder, event });
    };
    try {
      const report = await gen.run(folder, title, ctrl.signal, send);
      await logRun(v, folder, model, report).catch(() => undefined);
      return report;
    } catch (err) {
      if (err instanceof GenerationCancelled) throw err;
      throw new Error(`Generation failed, nothing was written. ${err instanceof Error ? err.message : ''}`.trim(), {
        cause: err,
      });
    } finally {
      running.delete(key);
    }
  });

  handle('generate:cancel', async ({ vaultId, folder }) => {
    running.get(runKey(vaultId, folder))?.abort();
  });
}
