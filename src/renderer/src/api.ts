import type { Result } from '@shared/ipc';

export const lode = window.lode;

export class ApiError extends Error {}

/** Unwraps an IPC result, throwing its message so callers can show it. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiError(r.error);
  return r.value;
}
