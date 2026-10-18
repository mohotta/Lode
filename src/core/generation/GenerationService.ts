import { randomInt } from 'node:crypto';
import type { Block, PointId, SubtopicInfo } from '@shared/types';
import type { ReadonlyBacklog } from '../repos/ReadonlyBacklog';
import type { GenerationInput, GenerationPoint, LlmAdapter, SearchResult, Usage } from '../llm/types';
import { ProviderError } from '../llm/types';
import { planNotes, type NotePlan } from './blocks';
import { estimateTokens, systemPrompt, userPrompt } from './prompt';
import {
  parseOutput,
  validateOutput,
  type UnsourcedPolicy,
  type ValidAssignment,
  type ValidCorrection,
} from './validate';

/**
 * The note-side capabilities generation needs. Implemented by NoteRepo, whose paths
 * are confined to `<folder>/notes/`. Generation has no way to reach backlog files.
 */
export interface NoteWriter {
  listSubtopics(folder: string): Promise<SubtopicInfo[]>;
  filing(folder: string): Promise<ReadonlyMap<PointId, readonly string[]>>;
  append(folder: string, subtopic: string, title: string, blocks: readonly Block[], updated: string): Promise<void>;
}

export interface GenerationSettings {
  useSearch: boolean;
  maxSearchesPerChunk: number;
  batchSize: number;
  unsourced: UnsourcedPolicy;
  maxInputTokens: number;
}

export type ProgressEvent =
  | { phase: 'collecting' }
  | { phase: 'calling'; chunk: number; chunks: number; retry: boolean }
  | { phase: 'searching'; query: string }
  | { phase: 'writing'; subtopics: number }
  | { phase: 'done' };

export interface GenerationReport {
  changed: { slug: string; title: string; isNew: boolean }[];
  filed: PointId[];
  unfiled: PointId[];
  warnings: string[];
  usage: Usage;
  sources: number;
  /** Points that received an AI correction note. */
  corrected: PointId[];
}

export interface Preview {
  points: number;
  chunks: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  useSearch: boolean;
  overCap: boolean;
}

const OUTPUT_TOKENS_PER_POINT = 350;
const SEARCH_TOKENS = 1200;

function blockId(): string {
  const a = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'b-';
  for (let i = 0; i < 8; i++) s += a[randomInt(a.length)];
  return s;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class GenerationCancelled extends Error {
  constructor() {
    super('Generation cancelled. Nothing was written.');
    this.name = 'GenerationCancelled';
  }
}

export interface GenerationDeps {
  backlog: ReadonlyBacklog;
  notes: NoteWriter;
  adapter: LlmAdapter;
  settings: GenerationSettings;
  now?: () => Date;
  newBlockId?: () => string;
}

export class GenerationService {
  private readonly now: () => Date;
  private readonly newBlockId: () => string;

  constructor(private readonly deps: GenerationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newBlockId = deps.newBlockId ?? blockId;
  }

  private async input(folder: string): Promise<{ points: GenerationPoint[]; subtopics: SubtopicInfo[] }> {
    const [unfiled, subtopics] = await Promise.all([
      this.deps.backlog.listUnfiled(folder),
      this.deps.notes.listSubtopics(folder),
    ]);
    return { points: unfiled.map((p) => ({ id: p.id, text: p.text, date: p.date })), subtopics };
  }

  async preview(folder: string, folderTitle: string): Promise<Preview> {
    const { points, subtopics } = await this.input(folder);
    const { settings } = this.deps;
    const chunks = chunk(points, settings.batchSize);
    let inputTokens = 0;
    for (const c of chunks) {
      inputTokens += estimateTokens(
        systemPrompt({ useSearch: settings.useSearch, maxSearches: settings.maxSearchesPerChunk }) +
          userPrompt({ folderTitle, points: c, subtopics }),
      );
      if (settings.useSearch) inputTokens += settings.maxSearchesPerChunk * SEARCH_TOKENS;
    }
    return {
      points: points.length,
      chunks: chunks.length,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: points.length * OUTPUT_TOKENS_PER_POINT,
      useSearch: settings.useSearch,
      overCap: inputTokens > settings.maxInputTokens,
    };
  }

  /**
   * Runs the whole pipeline. All model calls finish and validate before the first
   * write, so cancelling (or any provider error) leaves the vault untouched (FR-20).
   */
  async run(
    folder: string,
    folderTitle: string,
    signal: AbortSignal,
    onProgress: (e: ProgressEvent) => void = () => {},
  ): Promise<GenerationReport> {
    const { adapter, settings } = this.deps;
    onProgress({ phase: 'collecting' });
    const { points, subtopics } = await this.input(folder);
    const usage: Usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
    const warnings: string[] = [];
    if (points.length === 0) {
      onProgress({ phase: 'done' });
      return { changed: [], filed: [], unfiled: [], warnings: ['No unfiled points.'], usage, sources: 0, corrected: [] };
    }

    const known = subtopics.map((s) => ({ slug: s.slug, title: s.title }));
    const accepted: ValidAssignment[] = [];
    const corrections: ValidCorrection[] = [];
    const chunks = chunk(points, settings.batchSize);

    const callOnce = async (
      pts: GenerationPoint[],
      index: number,
      retry: boolean,
      repairHint?: string,
    ): Promise<{ output: unknown; searchResults: SearchResult[] }> => {
      if (signal.aborted) throw new GenerationCancelled();
      onProgress({ phase: 'calling', chunk: index + 1, chunks: chunks.length, retry });
      const input: GenerationInput = { folderTitle, points: pts, subtopics: known, ...(repairHint ? { repairHint } : {}) };
      try {
        const res = await adapter.generate(input, {
          signal,
          useSearch: settings.useSearch,
          maxSearches: settings.maxSearchesPerChunk,
          onSearch: (query) => onProgress({ phase: 'searching', query }),
        });
        usage.inputTokens += res.usage.inputTokens;
        usage.outputTokens += res.usage.outputTokens;
        usage.searches += res.usage.searches;
        return { output: res.json, searchResults: res.searchResults };
      } catch (err) {
        if (signal.aborted || (err instanceof ProviderError && err.kind === 'cancelled')) throw new GenerationCancelled();
        throw err;
      }
    };

    for (let i = 0; i < chunks.length; i++) {
      const pts = chunks[i] ?? [];
      let res = await callOnce(pts, i, false);
      let parsed = parseOutput(res.output);
      if (!parsed.ok) {
        res = await callOnce(pts, i, true, parsed.error);
        parsed = parseOutput(res.output);
      }
      if (!parsed.ok) {
        warnings.push(`The model returned invalid output twice (${parsed.error}); ${pts.length} point(s) left unfiled.`);
        continue;
      }
      let report = validateOutput(parsed.output, {
        sentIds: pts.map((p) => p.id),
        existingSubtopics: known,
        searchResults: res.searchResults,
        unsourced: settings.unsourced,
      });
      accepted.push(...report.assignments);
      corrections.push(...report.corrections);
      warnings.push(...report.warnings);

      // Rule 2: leftovers are retried once, then reported.
      if (report.leftovers.length) {
        const left = pts.filter((p) => report.leftovers.includes(p.id));
        const again = await callOnce(left, i, true, 'some points were not assigned; assign every point below');
        const p2 = parseOutput(again.output);
        if (p2.ok) {
          report = validateOutput(p2.output, {
            sentIds: left.map((p) => p.id),
            existingSubtopics: known,
            searchResults: again.searchResults,
            unsourced: settings.unsourced,
          });
          accepted.push(...report.assignments);
          for (const c of report.corrections) if (!corrections.some((x) => x.pointId === c.pointId)) corrections.push(c);
          warnings.push(...report.warnings);
          if (report.leftovers.length) warnings.push(`${report.leftovers.length} point(s) could not be filed and stay unfiled.`);
        } else {
          warnings.push(`${left.length} point(s) could not be filed and stay unfiled.`);
        }
      }
      // Later chunks reuse subtopics proposed by earlier ones.
      for (const a of report.assignments) {
        if (!known.some((k) => k.slug === a.subtopic.slug)) known.push({ slug: a.subtopic.slug, title: a.subtopic.title });
      }
    }

    if (signal.aborted) throw new GenerationCancelled();

    const filing = await this.deps.notes.filing(folder);
    const plans: NotePlan[] = planNotes(
      accepted,
      (slug) => new Set([...filing].filter(([, slugs]) => slugs.includes(slug)).map(([id]) => id)),
      { model: adapter.modelLabel, at: this.now().toISOString(), newBlockId: this.newBlockId },
      corrections,
    );

    onProgress({ phase: 'writing', subtopics: plans.length });
    const changed: GenerationReport['changed'] = [];
    const filed = new Set<PointId>();
    const updated = this.now().toISOString();
    for (const plan of plans) {
      try {
        await this.deps.notes.append(folder, plan.slug, plan.title, plan.blocks, updated);
        changed.push({ slug: plan.slug, title: plan.title, isNew: plan.isNew });
        for (const b of plan.blocks) if (b.kind === 'point') filed.add(b.id);
      } catch (err) {
        // HLD §6.3 step 4: other subtopics stay valid; report this one.
        warnings.push(`Could not write "${plan.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    onProgress({ phase: 'done' });
    return {
      changed,
      filed: [...filed],
      unfiled: points.map((p) => p.id).filter((id) => !filed.has(id)),
      warnings,
      usage,
      sources: new Set([
        ...accepted.flatMap((a) => a.additions.flatMap((x) => x.sources.map((s) => s.url))),
        ...corrections.flatMap((c) => c.sources.map((s) => s.url)),
      ]).size,
      corrected: corrections.map((c) => c.pointId).filter((id) => filed.has(id)),
    };
  }
}
