import { randomInt } from 'node:crypto';
import type { Block, PointId } from '@shared/types';
import { extractSources, type NoteFile } from '../formats/note';
import type { ArticleFile } from '../repos/ArticleRepo';
import type { ReadonlyBacklog } from '../repos/ReadonlyBacklog';
import type { ArticleIssue, ArticleTask, GenerationInput, GenerationPoint, LlmAdapter, Usage } from '../llm/types';
import { ProviderError } from '../llm/types';
import { GenerationCancelled, type GenerationReport, type GenerationSettings, type Preview, type ProgressEvent } from './GenerationService';
import { articleSystemPrompt, estimateTokens, userPrompt } from './prompt';
import { AllowedUrls } from './urls';
import { parseArticleCheck, parseArticleOutput, validateArticle, validateCheck, type ValidSection } from './validate';

/** Where notes (articles) are stored. Implemented by ArticleRepo (`<folder>/articles/`). */
export interface ArticleStore {
  read(folder: string, slug: string): Promise<ArticleFile | null>;
  readRaw(folder: string, slug: string): Promise<string | null>;
  create(folder: string, meta: { title: string; subtopics: string[]; topics: string[] }, blocks: readonly Block[], updated: string): Promise<string>;
  replace(folder: string, slug: string, expected: string, next: (current: ArticleFile) => ArticleFile, updated: string): Promise<ArticleFile>;
}

export interface ArticleDeps {
  /** Invariant 1: read-only view of the backlog. */
  backlog: ReadonlyBacklog;
  /** Subtopic notes, read only. */
  notes: { read(folder: string, subtopic: string): Promise<NoteFile | null> };
  articles: ArticleStore;
  adapter: LlmAdapter;
  settings: GenerationSettings;
  now?: () => Date;
  newBlockId?: () => string;
}

/** A new note: its title, the subtopics to build it from and extra topics to cover. */
export interface ArticleRequest {
  title: string;
  subtopics: string[];
  topics: string[];
}

/** Check rounds after the first draft. Each round that finds issues is followed by a revision. */
export const CHECK_ROUNDS = 3;

interface Job {
  title: string;
  material: { title: string; text: string }[];
  topics: string[];
  points: GenerationPoint[];
  allowed: AllowedUrls;
  subtopics: string[];
  instruction?: string;
  /** Revise: the stored note as text and its raw file for the compare-and-swap. */
  draft?: string;
  raw?: string;
}

interface Run {
  signal: AbortSignal;
  usage: Usage;
  onProgress: (e: ProgressEvent) => void;
}

/** Plain text of a note's blocks for the model: AI text as is, points as `[point id]` lines. */
export function blocksText(blocks: readonly Block[]): string {
  return blocks
    .flatMap((b) => {
      if (b.kind === 'point') return [`[point ${b.id}]`];
      if (b.kind === 'raw') return [b.text];
      return b.duplicate ? [] : [b.body];
    })
    .join('\n\n');
}

function sectionsText(sections: readonly ValidSection[]): string {
  return sections
    .map((s, i) => [`## ${i + 1}. ${s.heading}`, s.body, ...s.pointIds.map((id) => `[point ${id}]`)].filter(Boolean).join('\n\n'))
    .join('\n\n');
}

function blockId(): string {
  const a = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'b-';
  for (let i = 0; i < 8; i++) s += a[randomInt(a.length)];
  return s;
}

const UNSOURCED_NOTE = '*No cited source for this section; check it before relying on it.*';

/**
 * Notes (articles): an AI-written study note built from chosen subtopics and extra topics.
 * Each job drafts the note, then a checker pass reviews it and a revision fixes what it found,
 * up to CHECK_ROUNDS times, before anything is written. The model only ever names points by ID.
 */
export class ArticleService {
  private readonly now: () => Date;
  private readonly newBlockId: () => string;

  constructor(private readonly deps: ArticleDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newBlockId = deps.newBlockId ?? blockId;
  }

  private async collect(folder: string, subtopics: readonly string[], extraIds: readonly PointId[] = []): Promise<Omit<Job, 'title' | 'topics'>> {
    const allowed = new AllowedUrls();
    const ids = new Set<PointId>(extraIds);
    const material: Job['material'] = [];
    const found: string[] = [];
    for (const slug of subtopics) {
      const note = await this.deps.notes.read(folder, slug);
      if (!note) continue;
      found.push(slug);
      for (const b of note.blocks) {
        if (b.kind === 'point') ids.add(b.id);
        if (b.kind === 'llm') for (const s of b.sources) allowed.add(s.url, s.title);
      }
      material.push({ title: note.meta.title, text: blocksText(note.blocks) });
    }
    const live = await this.deps.backlog.listLive(folder);
    const points = live.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, text: p.text, date: p.date }));
    return { material, points, allowed, subtopics: found };
  }

  private async createJob(folder: string, req: ArticleRequest): Promise<Job> {
    const title = req.title.replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('Give the note a title.');
    const topics = [...new Set(req.topics.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    const c = await this.collect(folder, req.subtopics);
    if (c.material.length === 0 && topics.length === 0) throw new Error('Choose at least one subtopic or add a topic.');
    return { title, topics, ...c };
  }

  private async reviseJob(folder: string, slug: string, instruction: string): Promise<Job> {
    const raw = await this.deps.articles.readRaw(folder, slug);
    const a = raw === null ? null : await this.deps.articles.read(folder, slug);
    if (raw === null || !a) throw new Error('Note not found');
    const own = a.blocks.flatMap((b) => (b.kind === 'point' ? [b.id] : []));
    const c = await this.collect(folder, a.meta.subtopics, own);
    for (const b of a.blocks) if (b.kind === 'llm') for (const s of b.sources) c.allowed.add(s.url, s.title);
    return { title: a.meta.title, topics: a.meta.topics, ...c, subtopics: a.meta.subtopics, instruction, draft: blocksText(a.blocks), raw };
  }

  private estimate(job: Job, mode: ArticleTask['mode']): Preview {
    const input = this.input(job, { mode, ...(job.draft !== undefined ? { draft: job.draft } : {}) });
    const prompt = estimateTokens(articleSystemPrompt(mode, { useSearch: this.deps.settings.useSearch, maxSearches: 3 }) + userPrompt(input));
    const draftTokens = 600 + job.material.length * 400 + job.topics.length * 300;
    const searches = this.deps.settings.useSearch ? this.deps.settings.maxSearchesPerChunk * 1200 : 0;
    // The first draft, then on average two checks and one revision, each carrying the draft.
    const total = prompt + searches + 3 * (prompt + draftTokens + searches);
    return {
      points: job.points.length,
      chunks: 1,
      estimatedInputTokens: total,
      estimatedOutputTokens: draftTokens * 2 + 400,
      useSearch: this.deps.settings.useSearch,
      overCap: total > this.deps.settings.maxInputTokens,
    };
  }

  async previewCreate(folder: string, req: ArticleRequest): Promise<Preview> {
    return this.estimate(await this.createJob(folder, req), 'write');
  }

  async previewRevise(folder: string, slug: string, instruction: string): Promise<Preview> {
    return this.estimate(await this.reviseJob(folder, slug, instruction), 'revise');
  }

  private input(job: Job, task: Omit<ArticleTask, 'title' | 'material' | 'topics'>, folderTitle = ''): GenerationInput {
    return {
      folderTitle,
      points: job.points,
      subtopics: [],
      article: {
        title: job.title,
        material: job.material,
        topics: job.topics,
        // A fix round only addresses the checker's issues; the instruction was applied in the first draft.
        ...(job.instruction && !task.issues ? { instruction: job.instruction } : {}),
        ...task,
      },
    };
  }

  private async call(input: GenerationInput, job: Job, run: Run): Promise<unknown> {
    if (run.signal.aborted) throw new GenerationCancelled();
    const useSearch = this.deps.settings.useSearch;
    try {
      const res = await this.deps.adapter.generate(input, {
        signal: run.signal,
        useSearch,
        maxSearches: useSearch ? this.deps.settings.maxSearchesPerChunk : 0,
        onSearch: (query) => run.onProgress({ phase: 'searching', query }),
      });
      run.usage.inputTokens += res.usage.inputTokens;
      run.usage.outputTokens += res.usage.outputTokens;
      run.usage.searches += res.usage.searches;
      for (const r of res.searchResults) job.allowed.add(r.url, r.title);
      return res.json;
    } catch (err) {
      if (run.signal.aborted || (err instanceof ProviderError && err.kind === 'cancelled')) throw new GenerationCancelled();
      throw err;
    }
  }

  private async draft(job: Job, folderTitle: string, task: Omit<ArticleTask, 'title' | 'material' | 'topics'>, run: Run): Promise<{ sections: ValidSection[]; warnings: string[] }> {
    const input = this.input(job, task, folderTitle);
    let parsed = parseArticleOutput(await this.call(input, job, run));
    if (!parsed.ok) parsed = parseArticleOutput(await this.call({ ...input, repairHint: parsed.error }, job, run));
    if (!parsed.ok) throw new Error(`The model returned invalid output twice (${parsed.error}).`);
    const v = validateArticle(parsed.output, { sentIds: job.points.map((p) => p.id), allowed: job.allowed });
    if (v.sections.length === 0) throw new Error('The model returned nothing usable; nothing was written.');
    return v;
  }

  private async check(job: Job, folderTitle: string, sections: readonly ValidSection[], run: Run): Promise<ArticleIssue[]> {
    const input = this.input(job, { mode: 'check', draft: sectionsText(sections) }, folderTitle);
    let parsed = parseArticleCheck(await this.call(input, job, run));
    if (!parsed.ok) parsed = parseArticleCheck(await this.call({ ...input, repairHint: parsed.error }, job, run));
    // A checker that cannot answer in the right shape is no reason to throw the draft away.
    return parsed.ok ? validateCheck(parsed.output, sections.length) : [];
  }

  /** Draft, then check and fix until the checker finds nothing or the rounds run out. */
  private async loop(job: Job, folderTitle: string, run: Run): Promise<{ sections: ValidSection[]; warnings: string[]; rounds: number; open: number }> {
    run.onProgress({ phase: 'drafting', round: 0 });
    let v = await this.draft(job, folderTitle, job.draft !== undefined ? { mode: 'revise', draft: job.draft } : { mode: 'write' }, run);
    let rounds = 0;
    let open = 0;
    for (let round = 1; round <= CHECK_ROUNDS; round++) {
      run.onProgress({ phase: 'checking', round, rounds: CHECK_ROUNDS });
      const issues = await this.check(job, folderTitle, v.sections, run);
      rounds = round;
      open = issues.length;
      if (issues.length === 0 || round === CHECK_ROUNDS) break;
      run.onProgress({ phase: 'drafting', round });
      v = await this.draft(job, folderTitle, { mode: 'revise', draft: sectionsText(v.sections), issues }, run);
    }
    if (run.signal.aborted) throw new GenerationCancelled();
    const warnings = [...new Set(v.warnings)];
    if (open) warnings.push(`The checker still flagged ${open} issue(s) after ${rounds} round(s); review the note.`);
    return { sections: v.sections, warnings, rounds, open };
  }

  private blocks(sections: readonly ValidSection[]): Block[] {
    const meta = { model: this.deps.adapter.modelLabel, at: this.now().toISOString() };
    const out: Block[] = [];
    for (const s of sections) {
      const body = [`## ${s.heading}`, s.body, s.unsourced ? UNSOURCED_NOTE : ''].filter(Boolean).join('\n\n');
      out.push({ kind: 'llm', id: this.newBlockId(), ...meta, body, sources: extractSources(body) });
      for (const id of s.pointIds) out.push({ kind: 'point', id });
    }
    return out;
  }

  private report(slug: string, title: string, isNew: boolean, sections: readonly ValidSection[], warnings: string[], usage: Usage): GenerationReport {
    return {
      changed: [{ slug, title, isNew }],
      filed: [],
      unfiled: [],
      warnings,
      usage,
      sources: new Set(sections.flatMap((s) => [...s.body.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]))).size,
      corrected: [],
      duplicates: [],
    };
  }

  async create(
    folder: string,
    folderTitle: string,
    req: ArticleRequest,
    signal: AbortSignal,
    onProgress: (e: ProgressEvent) => void = () => {},
  ): Promise<GenerationReport> {
    onProgress({ phase: 'collecting' });
    const job = await this.createJob(folder, req);
    const run: Run = { signal, usage: { inputTokens: 0, outputTokens: 0, searches: 0 }, onProgress };
    const v = await this.loop(job, folderTitle, run);
    onProgress({ phase: 'writing', subtopics: 1 });
    const slug = await this.deps.articles.create(folder, { title: job.title, subtopics: job.subtopics, topics: job.topics }, this.blocks(v.sections), this.now().toISOString());
    onProgress({ phase: 'done' });
    return this.report(slug, job.title, true, v.sections, v.warnings, run.usage);
  }

  /** Edit with AI: the whole note is rewritten from the instruction, then checked like a new one. */
  async revise(
    folder: string,
    folderTitle: string,
    slug: string,
    instruction: string,
    signal: AbortSignal,
    onProgress: (e: ProgressEvent) => void = () => {},
  ): Promise<GenerationReport> {
    onProgress({ phase: 'collecting' });
    const job = await this.reviseJob(folder, slug, instruction.trim());
    const run: Run = { signal, usage: { inputTokens: 0, outputTokens: 0, searches: 0 }, onProgress };
    const v = await this.loop(job, folderTitle, run);
    onProgress({ phase: 'writing', subtopics: 1 });
    const blocks = this.blocks(v.sections);
    await this.deps.articles.replace(folder, slug, job.raw ?? '', (a) => ({ meta: a.meta, blocks }), this.now().toISOString());
    onProgress({ phase: 'done' });
    return this.report(slug, job.title, false, v.sections, v.warnings, run.usage);
  }
}
