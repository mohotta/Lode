import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KeyedMutex } from '../fs/mutex';
import { resolveInside } from '../fs/safePath';
import { isSlug } from '../formats/slug';

export const LODE_DIR = '.lode';

/** Shared handle on one vault directory: root path, path checks and the per-file write lock. */
export class Vault {
  readonly root: string;
  readonly locks = new KeyedMutex();

  constructor(root: string) {
    this.root = resolve(root);
  }

  path(...segments: string[]): Promise<string> {
    return resolveInside(this.root, ...segments);
  }

  folderPath(folder: string, ...rest: string[]): Promise<string> {
    assertSlug(folder, 'folder');
    return this.path(folder, ...rest);
  }

  async assertFolderExists(folder: string): Promise<void> {
    const p = await this.folderPath(folder, 'folder.json');
    try {
      await stat(p);
    } catch {
      throw new Error(`Folder not found: ${folder}`);
    }
  }
}

export function assertSlug(value: string, what: string): void {
  if (!isSlug(value)) throw new Error(`Invalid ${what} slug: ${JSON.stringify(value)}`);
}

/** Local calendar date, YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An ISO timestamp made safe for a file name: `2026-10-17T10:42:00.000Z` -> `2026-10-17T10-42-00-000Z`. */
export function fileStamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

export const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** Inverse of `fileStamp`. */
export function stampToIso(stamp: string): string {
  return stamp.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
}
