import { readdir, stat } from 'node:fs/promises';
import type { BacklogDay, Point, PointId } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import {
  DATE_RE,
  appendEntry,
  isCalendarDate,
  normalisePointText,
  parseBacklog,
  type BacklogFile,
} from '../formats/backlog';
import { newPointId, type RandomInt } from '../formats/ids';
import type { ReadonlyBacklog } from './ReadonlyBacklog';
import { LODE_DIR, Vault, localDate } from './Vault';

export type FilingLookup = (folder: string) => Promise<ReadonlyMap<PointId, readonly string[]>>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  file: BacklogFile;
}

export interface BacklogRepoOptions {
  now?: () => Date;
  rand?: RandomInt;
}

/**
 * Reads and appends backlog day files. Writing methods are reached only from the
 * user-initiated `backlog:*` IPC handlers; generation code gets `asReadonly()`.
 */
export class BacklogRepo {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => Date;
  private readonly rand: RandomInt | undefined;

  constructor(
    private readonly vault: Vault,
    opts: BacklogRepoOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.rand = opts.rand;
  }

  private async dayFiles(folder: string): Promise<string[]> {
    const dir = await this.vault.folderPath(folder, 'backlog');
    try {
      return (await readdir(dir))
        .filter((n) => n.endsWith('.md') && DATE_RE.test(n.slice(0, -3)))
        .sort()
        .reverse();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async readDay(folder: string, fileName: string): Promise<BacklogFile> {
    const path = await this.vault.folderPath(folder, 'backlog', fileName);
    const st = await stat(path);
    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.file;
    const content = (await readTextOrNull(path)) ?? '';
    const file = parseBacklog(content, fileName.slice(0, -3));
    this.cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, file });
    return file;
  }

  async listPoints(folder: string): Promise<Point[]> {
    const out: Point[] = [];
    for (const name of await this.dayFiles(folder)) {
      const day = await this.readDay(folder, name);
      const deleted = new Set(day.deleted);
      // Newest first within a day too, so the latest point is on top.
      for (const e of [...day.entries].reverse()) {
        out.push({ id: e.id, text: e.text, date: day.date, folder, deleted: deleted.has(e.id) });
      }
    }
    return out;
  }

  async listDays(
    folder: string,
    filing: ReadonlyMap<PointId, readonly string[]>,
    corrected: ReadonlySet<PointId> = new Set(),
  ): Promise<BacklogDay[]> {
    const days = new Map<string, BacklogDay>();
    for (const p of await this.listPoints(folder)) {
      let day = days.get(p.date);
      if (!day) days.set(p.date, (day = { date: p.date, points: [] }));
      day.points.push({ ...p, filedUnder: [...(filing.get(p.id) ?? [])], corrected: corrected.has(p.id) });
    }
    return [...days.values()];
  }

  private async allFolders(): Promise<string[]> {
    const entries = await readdir(this.vault.root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name !== LODE_DIR && !e.name.startsWith('.')).map((e) => e.name);
  }

  async allPointIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const folder of await this.allFolders()) {
      try {
        for (const p of await this.listPoints(folder)) ids.add(p.id);
      } catch {
        // Not a Lode folder (invalid slug or unreadable); it cannot hold point IDs.
      }
    }
    return ids;
  }

  async findPoint(folder: string, id: PointId): Promise<Point | undefined> {
    return (await this.listPoints(folder)).find((p) => p.id === id);
  }

  /**
   * User-initiated only (`backlog:add`). Appends to the day file for `onDate` (default today);
   * never rewrites existing lines. Dates after today are rejected.
   */
  async add(folder: string, input: string, onDate?: string): Promise<Point> {
    await this.vault.assertFolderExists(folder);
    const text = normalisePointText(input);
    const today = localDate(this.now());
    const date = onDate ?? today;
    if (!isCalendarDate(date)) throw new Error(`Not a valid date: ${JSON.stringify(date)}`);
    if (date > today) throw new Error('Points can only be added for today or an earlier day');
    const path = await this.vault.folderPath(folder, 'backlog', `${date}.md`);
    return this.vault.locks.run(path, async () => {
      const id = newPointId(await this.allPointIds(), this.rand);
      const existing = await readTextOrNull(path);
      await atomicWrite(path, appendEntry(existing, date, { id, text }));
      return { id, text, date, folder, deleted: false };
    });
  }

  /** The read-only view handed to generation code. No reference to this repo escapes. */
  asReadonly(filing: FilingLookup): ReadonlyBacklog {
    const listPoints = (folder: string): Promise<Point[]> => this.listPoints(folder);
    const findAnywhere = (id: PointId): Promise<Point | undefined> => this.findAnywhere(id);
    const freeze = (p: Point): Point => Object.freeze({ ...p });
    return Object.freeze({
      async listUnfiled(folder: string): Promise<readonly Point[]> {
        const [points, filed] = await Promise.all([listPoints(folder), filing(folder)]);
        // Oldest first, so the LLM sees points in the order they were learned.
        return Object.freeze(points.filter((p) => !p.deleted && !filed.has(p.id)).reverse().map(freeze));
      },
      async get(id: PointId): Promise<Point | undefined> {
        const p = await findAnywhere(id);
        return p && freeze(p);
      },
    });
  }

  async findAnywhere(id: PointId): Promise<Point | undefined> {
    for (const folder of await this.allFolders()) {
      try {
        const p = await this.findPoint(folder, id);
        if (p) return p;
      } catch {
        // Skip directories that are not Lode folders.
      }
    }
    return undefined;
  }
}
