import type { Result } from '@shared/ipc';

export const lode = window.lode;

export class ApiError extends Error {}

/**
 * Asks with a native OS dialog. Falls back to the browser confirm if the native call is missing
 * or fails (e.g. a dev session whose preload predates the channel), so the action never silently stops.
 */
export async function ask(opts: { message: string; detail?: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  try {
    const r = await lode.ui.confirm(opts);
    if (r.ok) return r.value;
  } catch {
    // Fall through to the in-page confirm.
  }
  return confirm([opts.message, opts.detail].filter(Boolean).join('\n\n'));
}

/** Unwraps an IPC result, throwing its message so callers can show it. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiError(r.error);
  return r.value;
}
