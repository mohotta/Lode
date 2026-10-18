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

export interface GenerationInput {
  folderTitle: string;
  points: readonly GenerationPoint[];
  subtopics: readonly { slug: string; title: string }[];
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
