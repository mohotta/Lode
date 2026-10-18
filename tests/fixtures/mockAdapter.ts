import type { GenerateOptions, GenerateResult, GenerationInput, LlmAdapter, SearchResult } from '../../src/core/llm/types';

export type Responder = (input: GenerationInput, call: number, opts: GenerateOptions) => unknown | Promise<unknown>;

/** Scripted adapter: `responder` returns the raw JSON the "model" would produce. */
export class MockAdapter implements LlmAdapter {
  readonly id = 'mock' as const;
  readonly modelLabel = 'mock/model-1';
  readonly supportsNativeSearch = true;
  calls: GenerationInput[] = [];

  constructor(
    private readonly responder: Responder,
    private readonly searchResults: SearchResult[] = [],
  ) {}

  async generate(input: GenerationInput, opts: GenerateOptions): Promise<GenerateResult> {
    this.calls.push(input);
    const json = await this.responder(input, this.calls.length, opts);
    return { json, searchResults: this.searchResults, usage: { inputTokens: 100, outputTokens: 50, searches: 1 } };
  }

  async testConnection(): Promise<void> {}
}

export const RESULTS: SearchResult[] = [
  { title: 'Service | Kubernetes', url: 'https://kubernetes.io/docs/concepts/services-networking/service/', snippet: '...' },
  { title: 'IPVS proxy mode', url: 'https://kubernetes.io/docs/reference/networking/virtual-ips/', snippet: '...' },
];
