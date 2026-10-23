import type { Result } from '@shared/ipc';

export const lode = window.lode;

export class ApiError extends Error {}

export interface AskOptions {
  message: string;
  detail?: string;
  confirmLabel: string;
  danger?: boolean;
}

let opener: ((opts: AskOptions) => Promise<boolean>) | null = null;

/** Registered by `ConfirmHost` when it mounts. */
export function setConfirmOpener(fn: ((opts: AskOptions) => Promise<boolean>) | null): void {
  opener = fn;
}

/**
 * Asks with the app's own confirmation dialog (`ConfirmHost`). Falls back to the browser confirm
 * if the host isn't mounted, so an action never silently stops.
 */
export async function ask(opts: AskOptions): Promise<boolean> {
  if (opener) return opener(opts);
  return confirm([opts.message, opts.detail].filter(Boolean).join('\n\n'));
}

/** Unwraps an IPC result, throwing its message so callers can show it. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiError(r.error);
  return r.value;
}
