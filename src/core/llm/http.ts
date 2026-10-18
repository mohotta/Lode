import { ProviderError } from './types';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PostOptions {
  fetch: FetchLike;
  signal: AbortSignal;
  headers: Record<string, string>;
  /** Total attempts for 429/5xx with exponential backoff. */
  attempts?: number;
  baseDelayMs?: number;
  label: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ProviderError('Cancelled', 'cancelled'));
      },
      { once: true },
    );
  });
}

/** POSTs JSON with retry on 429/5xx. Error messages never include request bodies or headers (keys). */
export async function postJson(url: string, body: unknown, o: PostOptions): Promise<unknown> {
  const attempts = o.attempts ?? 3;
  const base = o.baseDelayMs ?? 800;
  for (let attempt = 1; ; attempt++) {
    if (o.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
    let res: Response;
    try {
      res = await o.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify(body),
        signal: o.signal,
      });
    } catch (err) {
      if (o.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      throw new ProviderError(`${o.label}: network error (${err instanceof Error ? err.message : 'unknown'})`, 'network');
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new ProviderError(`${o.label}: response was not JSON`, 'bad-response');
      }
    }
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < attempts) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** (attempt - 1);
      await sleep(Math.min(delay, 20_000), o.signal);
      continue;
    }
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: unknown } | string; detail?: unknown };
      const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.detail;
      if (typeof m === 'string') detail = `: ${m.slice(0, 300)}`;
    } catch {
      // Non-JSON error body; status alone is enough.
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(`${o.label}: authentication failed (HTTP ${res.status})${detail}`, 'auth');
    }
    if (res.status === 429) throw new ProviderError(`${o.label}: rate limited, try again shortly${detail}`, 'rate-limit');
    throw new ProviderError(`${o.label}: HTTP ${res.status}${detail}`, res.status === 400 ? 'bad-response' : 'other');
  }
}
