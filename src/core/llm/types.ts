import type { PointId } from '@shared/types';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searches: number;
}

export interface GenerationPoint {
  id: PointId;
  text: string;
  date: string;
}

export interface ArticleIssue {
  /** 1-based section number, or 0 for the note as a whole. */
  section: number;
  problem: string;
  fix: string;
}

/** A note (article) job step: write it, check a draft, or revise a draft. */
export interface ArticleTask {
  mode: 'write' | 'check' | 'revise';
  title: string;
  /** The chosen subtopic notes as plain text; the user's points appear as `[point p-…]` lines. */
  material: readonly { title: string; text: string }[];
  /** Extra topics to cover that have no subtopic yet. */
  topics: readonly string[];
  /** The user's instruction for an AI edit. */
  instruction?: string;
  /** The current note as text (check and revise). */
  draft?: string;
  /** What the checker found (revise after a check). */
  issues?: readonly ArticleIssue[];
}

export interface GenerationInput {
  folderTitle: string;
  points: readonly GenerationPoint[];
  subtopics: readonly { slug: string; title: string }[];
  /** Earlier, already-filed points (short excerpts) so the model can flag repeats. File mode only. */
  knownPoints?: readonly GenerationPoint[];
  /** Set for a digest: recap the points of this period instead of filing them. */
  digest?: { title: string; from: string; to: string };
  /** Set for a note (article) step. */
  article?: ArticleTask;
  /** Set for Regenerate: every point is already filed under this subtopic. */
  regenerate?: { slug: string; title: string };
  /** Set when retrying after invalid output, describing what was wrong. */
  repairHint?: string;
}

export interface GenerateOptions {
  signal: AbortSignal;
  useSearch: boolean;
  maxSearches: number;
  onSearch?(query: string): void;
}

export interface GenerateResult {
  /** Unvalidated model output. Zod in GenerationService is the final authority. */
  json: unknown;
  /** Every search result seen in this call. Source URLs must come from here. */
  searchResults: SearchResult[];
  usage: Usage;
}

export interface LlmAdapter {
  readonly id: 'openai-compatible' | 'mock';
  /** `provider/model`, recorded on each generated block. */
  readonly modelLabel: string;
  readonly supportsNativeSearch: boolean;
  generate(input: GenerationInput, opts: GenerateOptions): Promise<GenerateResult>;
  testConnection(signal?: AbortSignal): Promise<void>;
}

export interface SearchProvider {
  readonly id: 'tavily';
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
  testConnection(signal?: AbortSignal): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'network' | 'bad-response' | 'cancelled' | 'other',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
