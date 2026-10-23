import { ipcMain } from 'electron';
import { Schemas, type Channel, type Input, type Result } from '@shared/ipc';
import { friendlyError } from '../errors';

/** Registers a handler whose input is validated by the channel's Zod schema. Errors become `{ok:false}`. */
export function handle<C extends Channel, T>(channel: C, fn: (input: Input<C>) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<T>> => {
    const parsed = Schemas[channel].safeParse(raw ?? {});
    if (!parsed.success) return { ok: false, error: `Invalid request for ${channel}` };
    try {
      return { ok: true, value: await fn(parsed.data as Input<C>) };
    } catch (err) {
      // Messages only; stacks and request payloads are not echoed back or logged (they may hold user text).
      return { ok: false, error: friendlyError(err) };
    }
  });
}
