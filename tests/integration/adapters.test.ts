import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleAdapter, chatUrl, extractJson } from '@core/llm/openaiCompatible';
import { TavilySearch } from '@core/llm/tavily';
import { ProviderError, type GenerationInput } from '@core/llm/types';
import { chatText, chatToolCall, scriptedFetch } from '../fixtures/fakeFetch';

const KEY = 'sk-test-not-a-real-key';
const input: GenerationInput = {
  folderTitle: 'Kubernetes',
  points: [{ id: 'p-aaaaaaaa', text: 'ClusterIP is internal', date: '2026-10-17' }],
  subtopics: [{ slug: 'networking', title: 'Networking' }],
};
const OUTPUT = { assignments: [] };

const tavilyResponse = {
  query: 'k8s clusterip',
  results: [
    { title: 'Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/', content: 'snippet', score: 0.9 },
    { title: 'Bad scheme', url: 'javascript:alert(1)', content: 'x', score: 0.1 },
  ],
  usage: { credits: 1 },
};

const opts = (over: Partial<Parameters<OpenAiCompatibleAdapter['generate']>[1]> = {}) => ({
  signal: new AbortController().signal,
  useSearch: true,
  maxSearches: 2,
  ...over,
});

describe('extractJson', () => {
  it('handles plain, fenced and prose-wrapped JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(extractJson('nope')).toBeUndefined();
  });
});

describe('chatUrl', () => {
  it('appends /chat/completions and rejects non-http schemes', () => {
    expect(chatUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
    expect(() => chatUrl('file:///etc/passwd')).toThrow();
  });
});

describe('TavilySearch', () => {
  it('posts the query with bearer auth and filters non-http results', async () => {
    const { fetch, calls } = scriptedFetch([{ json: tavilyResponse }]);
    const t = new TavilySearch({ getKey: async () => 'tvly-test', fetch });
    const r = await t.search('k8s clusterip', new AbortController().signal);
    expect(calls[0]?.url).toBe('https://api.tavily.com/search');
    expect(calls[0]?.headers.authorization).toBe('Bearer tvly-test');
    expect(calls[0]?.body).toMatchObject({ query: 'k8s clusterip', max_results: 5 });
    expect(r).toEqual([{ title: 'Service', url: tavilyResponse.results[0]!.url, snippet: 'snippet' }]);
  });
});

describe('OpenAiCompatibleAdapter', () => {
  it('runs the search tool loop and records every result URL', async () => {
    const llm = scriptedFetch([{ json: chatToolCall('call_1', 'k8s clusterip') }, { json: chatText(JSON.stringify(OUTPUT)) }]);
    const tav = scriptedFetch([{ json: tavilyResponse }]);
    const searches: string[] = [];
    const a = new OpenAiCompatibleAdapter({
      baseUrl: 'https://api.example.com/v1',
      model: 'm-1',
      getKey: async () => KEY,
      fetch: llm.fetch,
      search: new TavilySearch({ getKey: async () => 'tvly', fetch: tav.fetch }),
    });
    const res = await a.generate(input, opts({ onSearch: (q) => searches.push(q) }));
    expect(res.json).toEqual(OUTPUT);
    expect(res.searchResults.map((r) => r.url)).toEqual([tavilyResponse.results[0]!.url]);
    expect(res.usage).toEqual({ inputTokens: 30, outputTokens: 13, searches: 1 });
    expect(searches).toEqual(['k8s clusterip']);

    const first = llm.calls[0]!;
    expect(first.url).toBe('https://api.example.com/v1/chat/completions');
    expect(first.headers.authorization).toBe(`Bearer ${KEY}`);
    expect((first.body.tools as unknown[]).length).toBe(1);
    const second = llm.calls[1]!.body.messages as Array<{ role: string; content: string; tool_call_id?: string }>;
    const tool = second.find((m) => m.role === 'tool');
    expect(tool?.tool_call_id).toBe('call_1');
    expect(tool?.content).toContain('UNTRUSTED');
  });

  it('stops offering the tool after the search cap', async () => {
    const llm = scriptedFetch([
      { json: chatToolCall('c1', 'q1') },
      { json: chatText(JSON.stringify(OUTPUT)) },
    ]);
    const tav = scriptedFetch([{ json: tavilyResponse }]);
    const a = new OpenAiCompatibleAdapter({
      baseUrl: 'https://x.test/v1',
      model: 'm',
      getKey: async () => '',
      fetch: llm.fetch,
      search: new TavilySearch({ getKey: async () => 't', fetch: tav.fetch }),
    });
    await a.generate(input, opts({ maxSearches: 1 }));
    expect(llm.calls[1]?.body.tools).toBeUndefined();
    // No key configured (local server): no authorization header is sent.
    expect(llm.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('does not offer tools when search is off', async () => {
    const llm = scriptedFetch([{ json: chatText(JSON.stringify(OUTPUT)) }]);
    const a = new OpenAiCompatibleAdapter({ baseUrl: 'https://x.test/v1', model: 'm', getKey: async () => KEY, fetch: llm.fetch });
    const res = await a.generate(input, opts({ useSearch: true }));
    expect(llm.calls[0]?.body.tools).toBeUndefined();
    expect(res.searchResults).toEqual([]);
  });

  it('asks once more for JSON (json_object, then plain) when the reply is not JSON', async () => {
    const llm = scriptedFetch([
      { json: chatText('Here are my thoughts...') },
      { status: 400, json: { error: { message: 'response_format not supported' } } },
      { json: chatText(JSON.stringify(OUTPUT)) },
    ]);
    const a = new OpenAiCompatibleAdapter({ baseUrl: 'https://x.test/v1', model: 'm', getKey: async () => KEY, fetch: llm.fetch });
    const res = await a.generate(input, opts({ useSearch: false }));
    expect(res.json).toEqual(OUTPUT);
    expect(llm.calls[1]?.body.response_format).toEqual({ type: 'json_object' });
    expect(llm.calls[2]?.body.response_format).toBeUndefined();
  });

  it('retries 429 with backoff, then succeeds', async () => {
    const llm = scriptedFetch([
      { status: 429, json: { error: { message: 'slow down' } }, headers: { 'retry-after': '0' } },
      { json: chatText(JSON.stringify(OUTPUT)) },
    ]);
    const a = new OpenAiCompatibleAdapter({ baseUrl: 'https://x.test/v1', model: 'm', getKey: async () => KEY, fetch: llm.fetch });
    await expect(a.generate(input, opts({ useSearch: false }))).resolves.toMatchObject({ json: OUTPUT });
    expect(llm.calls).toHaveLength(2);
  });

  it('reports invalid keys clearly without echoing the key', async () => {
    const llm = scriptedFetch([{ status: 401, json: { error: { message: 'Incorrect API key provided' } } }]);
    const a = new OpenAiCompatibleAdapter({ baseUrl: 'https://x.test/v1', model: 'm', getKey: async () => KEY, fetch: llm.fetch });
    const err = await a.generate(input, opts({ useSearch: false })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('auth');
    expect((err as Error).message).toMatch(/authentication failed \(HTTP 401\)/);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('surfaces cancellation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const llm = scriptedFetch([{ json: chatText('{}') }]);
    const a = new OpenAiCompatibleAdapter({ baseUrl: 'https://x.test/v1', model: 'm', getKey: async () => KEY, fetch: llm.fetch });
    const err = await a.generate(input, opts({ signal: ctrl.signal })).catch((e: unknown) => e);
    expect((err as ProviderError).kind).toBe('cancelled');
  });
});
