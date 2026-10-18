import { z } from 'zod';
import { postJson, type FetchLike } from './http';
import type { SearchProvider, SearchResult } from './types';

const TavilyResponse = z.object({
  results: z
    .array(z.object({ title: z.string().default(''), url: z.string(), content: z.string().default('') }))
    .default([]),
});

export interface TavilyOptions {
  /** Read from KeyStore at call time; never stored on this object. */
  getKey(): Promise<string>;
  fetch?: FetchLike;
  endpoint?: string;
  maxResults?: number;
}

/** Tavily search (POST /search, Bearer auth). Results are untrusted data. */
export class TavilySearch implements SearchProvider {
  readonly id = 'tavily' as const;
  private readonly endpoint: string;
  private readonly fetch: FetchLike;

  constructor(private readonly o: TavilyOptions) {
    this.endpoint = o.endpoint ?? 'https://api.tavily.com/search';
    this.fetch = o.fetch ?? ((u, i) => fetch(u, i));
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const key = await this.o.getKey();
    const json = await postJson(
      this.endpoint,
      { query: query.slice(0, 400), max_results: this.o.maxResults ?? 5, search_depth: 'basic', include_answer: false },
      { fetch: this.fetch, signal, headers: { authorization: `Bearer ${key}` }, label: 'Tavily' },
    );
    const parsed = TavilyResponse.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.results
      .filter((r) => /^https?:\/\//i.test(r.url))
      .map((r) => ({ title: r.title.slice(0, 300), url: r.url, snippet: r.content.slice(0, 1500) }));
  }

  async testConnection(signal: AbortSignal = AbortSignal.timeout(15_000)): Promise<void> {
    await this.search('test', signal);
  }
}
