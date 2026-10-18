import { randomInt } from 'node:crypto';
import type { Block, PointId, SubtopicInfo } from '@shared/types';
import type { ReadonlyBacklog } from '../repos/ReadonlyBacklog';
import type { GenerationInput, GenerationPoint, LlmAdapter, SearchResult, Usage } from '../llm/types';
import { ProviderError } from '../llm/types';
import { duplicatesIn, parseNote, pointIdsIn, type NoteFile } from '../formats/note';
import { layoutRegenerated, planNotes, type NotePlan } from './blocks';
import { estimateTokens, systemPrompt, userPrompt } from './prompt';
import {
  parseOutput,
  validateOutput,
  type UnsourcedPolicy,
  type ValidAssignment,
  type ValidCorrection,
  type ValidDuplicate,
  type ValidationReport,
} from './validate';

/**
 * The note-side capabilities generation needs. Implemented by NoteRepo, whose paths
 * are confined to `<folder>/notes/`. Generation has no way to reach backlog files.
 */
export interface NoteWriter {
  listSubtopics(folder: string): Promise<SubtopicInfo[]>;
  filing(folder: string): Promise<ReadonlyMap<PointId, readonly string[]>>;
  append(folder: string, subtopic: string, title: string, blocks: readonly Block[], updated: string): Promise<void>;
  readRaw(folder: string, subtopic: string): Promise<string | null>;
  /** Regenerate's write: replaces the note body if it still equals `expected`, keeping a history snapshot. */
  replaceBlocks(folder: string, subtopic: string, expected: string, blocks: readonly Block[], updated: string): Promise<void>;
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
  /** Points filed as repeats of an earlier point. */
  duplicates: PointId[];
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
/** Duplicate detection context: at most this many recent filed points, each cut to an excerpt. */
const KNOWN_POINTS_MAX = 150;
const KNOWN_EXCERPT_CHARS = 160;

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

interface Collected {
  accepted: ValidAssignment[];
  corrections: ValidCorrection[];
  duplicates: ValidDuplicate[];
  warnings: string[];
  usage: Usage;
}

interface Job {
  folderTitle: string;
  points: GenerationPoint[];
  subtopics: { slug: string; title: string }[];
  knownPoints: GenerationPoint[];
  regenerate?: { slug: string; title: string };
}

export class GenerationService {
  private readonly now: () => Date;
  private readonly newBlockId: () => string;

  constructor(private readonly deps: GenerationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newBlockId = deps.newBlockId ?? blockId;
  }

  private async fileJob(folder: string, folderTitle: string): Promise<Job> {
    const [unfiled, live, subtopics, filing] = await Promise.all([
      this.deps.backlog.listUnfiled(folder),
      this.deps.backlog.listLive(folder),
      this.deps.notes.listSubtopics(folder),
      this.deps.notes.filing(folder),
    ]);
    const knownPoints = live
      .filter((p) => filing.has(p.id))
      .slice(-KNOWN_POINTS_MAX)
      .map((p) => ({ id: p.id, date: p.date, text: p.text.slice(0, KNOWN_EXCERPT_CHARS) }));
    return {
      folderTitle,
      points: unfiled.map((p) => ({ id: p.id, text: p.text, date: p.date })),
      subtopics: subtopics.map((s) => ({ slug: s.slug, title: s.title })),
      knownPoints,
    };
  }

  private async regenerateJob(
    folder: string,
    folderTitle: string,
    subtopic: string,
  ): Promise<Job & { raw: string; note: NoteFile }> {
    const raw = await this.deps.notes.readRaw(folder, subtopic);
    if (raw === null) throw new Error('Note not found');
    const note = parseNote(raw, { folder, subtopic });
    const live = new Map((await this.deps.backlog.listLive(folder)).map((p) => [p.id, p]));
    const repeats = duplicatesIn(note.blocks);
    const ids = [...new Set(pointIdsIn(note.blocks))].filter((id) => live.has(id) && !repeats.has(id));
    const target = { slug: subtopic, title: note.meta.title };
    return {
      folderTitle,
      points: ids.flatMap((id) => {
        const p = live.get(id);
        return p ? [{ id: p.id, text: p.text, date: p.date }] : [];
      }),
      subtopics: [target],
      knownPoints: [],
      regenerate: target,
      raw,
      note,
    };
  }

  private estimate(job: Job): Preview {
    const { settings } = this.deps;
    const chunks = chunk(job.points, settings.batchSize);
    let inputTokens = 0;
    for (const c of chunks) {
      inputTokens += estimateTokens(
        systemPrompt({ useSearch: settings.useSearch, maxSearches: settings.maxSearchesPerChunk, regenerate: !!job.regenerate }) +
          userPrompt(this.input(job, c)),
      );
      if (settings.useSearch) inputTokens += settings.maxSearchesPerChunk * SEARCH_TOKENS;
    }
    return {
      points: job.points.length,
      chunks: chunks.length,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: job.points.length * OUTPUT_TOKENS_PER_POINT,
      useSearch: settings.useSearch,
      overCap: inputTokens > settings.maxInputTokens,
    };
  }

  private input(job: Job, points: GenerationPoint[], repairHint?: string): GenerationInput {
    return {
      folderTitle: job.folderTitle,
      points,
      subtopics: job.subtopics,
      ...(job.knownPoints.length ? { knownPoints: job.knownPoints } : {}),
      ...(job.regenerate ? { regenerate: job.regenerate } : {}),
      ...(repairHint ? { repairHint } : {}),
    };
  }

  async preview(folder: string, folderTitle: string): Promise<Preview> {
    return this.estimate(await this.fileJob(folder, folderTitle));
  }

  async previewRegenerate(folder: string, folderTitle: string, subtopic: string): Promise<Preview> {
    return this.estimate(await this.regenerateJob(folder, folderTitle, subtopic));
  }

  /**
   * All model calls for a job, chunked, with one repair retry for invalid output and one
   * retry for unassigned points (HLD §6.2 rule 2). Nothing is written here.
   */
  private async collect(job: Job, signal: AbortSignal, onProgress: (e: ProgressEvent) => void): Promise<Collected> {
    const { adapter, settings } = this.deps;
    const usage: Usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
    const warnings: string[] = [];
    const accepted: ValidAssignment[] = [];
    const corrections: ValidCorrection[] = [];
    const duplicates: ValidDuplicate[] = [];
    const known = [...job.subtopics];
    const knownIds = job.knownPoints.map((p) => p.id);
    const chunks = chunk(job.points, settings.batchSize);
    // Regenerate files nothing new: every assignment goes to the note being rewritten.
    const target = job.regenerate;
    const pin = (r: ValidationReport): ValidationReport =>
      target
        ? {
            ...r,
            duplicates: [],
            assignments: r.assignments.map((a) => ({ ...a, subtopic: { ...target, isNew: false } })),
          }
        : r;

    const callOnce = async (
      pts: GenerationPoint[],
      index: number,
      retry: boolean,
      repairHint?: string,
    ): Promise<{ output: unknown; searchResults: SearchResult[] }> => {
      if (signal.aborted) throw new GenerationCancelled();
      onProgress({ phase: 'calling', chunk: index + 1, chunks: chunks.length, retry });
      try {
        const res = await adapter.generate(this.input({ ...job, subtopics: known }, pts, repairHint), {
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

    const take = (report: ValidationReport): void => {
      accepted.push(...report.assignments);
      for (const c of report.corrections) if (!corrections.some((x) => x.pointId === c.pointId)) corrections.push(c);
      for (const d of report.duplicates) if (!duplicates.some((x) => x.pointId === d.pointId)) duplicates.push(d);
      warnings.push(...report.warnings);
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
      // Earlier chunks count as "known" for repeats in later ones.
      const earlier = chunks.slice(0, i).flat().map((p) => p.id);
      let report = pin(
        validateOutput(parsed.output, {
          sentIds: pts.map((p) => p.id),
          knownIds: [...knownIds, ...earlier],
          existingSubtopics: known,
          searchResults: res.searchResults,
          unsourced: settings.unsourced,
        }),
      );
      take(report);

      // Rule 2: leftovers are retried once, then reported.
      if (report.leftovers.length) {
        const left = pts.filter((p) => report.leftovers.includes(p.id));
        const again = await callOnce(left, i, true, 'some points were not assigned; assign every point below');
        const p2 = parseOutput(again.output);
        if (p2.ok) {
          report = pin(
            validateOutput(p2.output, {
              sentIds: left.map((p) => p.id),
              knownIds: [...knownIds, ...earlier],
              existingSubtopics: known,
              searchResults: again.searchResults,
              unsourced: settings.unsourced,
            }),
          );
          take(report);
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
    return { accepted, corrections, duplicates, warnings, usage };
  }

  private sources(c: Collected): number {
    return new Set([
      ...c.accepted.flatMap((a) => a.additions.flatMap((x) => x.sources.map((s) => s.url))),
      ...c.corrections.flatMap((x) => x.sources.map((s) => s.url)),
    ]).size;
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
    onProgress({ phase: 'collecting' });
    const job = await this.fileJob(folder, folderTitle);
    if (job.points.length === 0) {
      onProgress({ phase: 'done' });
      return {
        changed: [],
        filed: [],
        unfiled: [],
        warnings: ['No unfiled points.'],
        usage: { inputTokens: 0, outputTokens: 0, searches: 0 },
        sources: 0,
        corrected: [],
        duplicates: [],
      };
    }
    const got = await this.collect(job, signal, onProgress);

    const filing = await this.deps.notes.filing(folder);
    const titles = new Map(job.subtopics.map((s) => [s.slug, s.title]));
    const plans: NotePlan[] = planNotes(
      got.accepted,
      (slug) => new Set([...filing].filter(([, slugs]) => slugs.includes(slug)).map(([id]) => id)),
      { model: this.deps.adapter.modelLabel, at: this.now().toISOString(), newBlockId: this.newBlockId },
      got.corrections,
      {
        duplicates: got.duplicates,
        filedUnder: (id) => filing.get(id) ?? [],
        titleOf: (slug) => titles.get(slug) ?? slug,
      },
    );

    onProgress({ phase: 'writing', subtopics: plans.length });
    const changed: GenerationReport['changed'] = [];
    const filed = new Set<PointId>();
    const repeats = new Set<PointId>();
    const updated = this.now().toISOString();
    for (const plan of plans) {
      try {
        await this.deps.notes.append(folder, plan.slug, plan.title, plan.blocks, updated);
        changed.push({ slug: plan.slug, title: plan.title, isNew: plan.isNew });
        for (const b of plan.blocks) {
          if (b.kind === 'point') filed.add(b.id);
          if (b.kind === 'llm' && b.duplicate) repeats.add(b.duplicate.id);
        }
      } catch (err) {
        // HLD §6.3 step 4: other subtopics stay valid; report this one.
        got.warnings.push(`Could not write "${plan.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    onProgress({ phase: 'done' });
    return {
      changed,
      filed: [...filed],
      unfiled: job.points.map((p) => p.id).filter((id) => !filed.has(id)),
      warnings: got.warnings,
      usage: got.usage,
      sources: this.sources(got),
      corrected: got.corrections.map((c) => c.pointId).filter((id) => filed.has(id) && !repeats.has(id)),
      duplicates: [...repeats],
    };
  }

  /**
   * Regenerate one note (HLD §6.4, FR-18): sends every live point the note references and
   * replaces only its AI blocks. Markers keep their order; the old file goes to history first.
   */
  async regenerate(
    folder: string,
    folderTitle: string,
    subtopic: string,
    signal: AbortSignal,
    onProgress: (e: ProgressEvent) => void = () => {},
  ): Promise<GenerationReport> {
    onProgress({ phase: 'collecting' });
    const job = await this.regenerateJob(folder, folderTitle, subtopic);
    if (job.points.length === 0) throw new Error('This note has no points left to regenerate from.');
    const got = await this.collect(job, signal, onProgress);
    if (got.accepted.length === 0 && got.corrections.length === 0) {
      throw new Error(`The model returned nothing usable; the note was left unchanged. ${got.warnings.join(' ')}`.trim());
    }
    const blocks = layoutRegenerated(job.note.blocks, got.accepted, got.corrections, {
      model: this.deps.adapter.modelLabel,
      at: this.now().toISOString(),
      newBlockId: this.newBlockId,
    });
    onProgress({ phase: 'writing', subtopics: 1 });
    await this.deps.notes.replaceBlocks(folder, subtopic, job.raw, blocks, this.now().toISOString());
    onProgress({ phase: 'done' });
    const covered = new Set(got.accepted.flatMap((a) => a.pointIds));
    return {
      changed: [{ slug: subtopic, title: job.note.meta.title, isNew: false }],
      filed: [...covered],
      unfiled: [],
      warnings: got.warnings,
      usage: got.usage,
      sources: this.sources(got),
      corrected: got.corrections.map((c) => c.pointId),
      duplicates: [],
    };
  }
}
