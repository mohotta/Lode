import type { FetchLike } from '../../src/core/llm/http';

export interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Scripted fetch: each call pops the next response. Records requests for assertions. */
export function scriptedFetch(responses: Array<{ status?: number; json: unknown; headers?: Record<string, string> }>): {
  fetch: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = responses.shift();
    if (!next) throw new Error('No scripted response left');
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  };
  return { fetch, calls };
}

export const chatText = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage,
});

export const chatToolCall = (id: string, query: string) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query }) } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 8 },
});
