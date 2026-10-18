import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Block, DigestInfo, DigestPeriod, Point } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import { parseNote, pointIdsIn, serialiseNote, type NoteFile } from '../formats/note';
import { monthOf, periodRange, weekOf } from '../formats/period';
import { LODE_DIR, Vault, fileStamp } from './Vault';

/**
 * Digest notes (FR-26, HLD §6.5): `<folder>/digests/<period>.md`, in the note format with
 * point markers, so highlighting works as in subtopic notes. They live outside `notes/`,
 * so a digest never counts as filing a point.
 */
export class DigestRepo {
  constructor(private readonly vault: Vault) {}

  private path(folder: string, id: string): Promise<string> {
    if (!periodRange(id)) throw new Error(`Invalid digest period: ${JSON.stringify(id)}`);
    return this.vault.folderPath(folder, 'digests', `${id}.md`);
  }

  async list(folder: string): Promise<DigestInfo[]> {
    let names: string[];
    try {
      names = await readdir(await this.vault.folderPath(folder, 'digests'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: DigestInfo[] = [];
    for (const n of names) {
      const id = n.replace(/\.md$/, '');
      const range = n.endsWith('.md') ? periodRange(id) : null;
      if (!range) continue;
      const note = await this.read(folder, id);
      if (!note) continue;
      out.push({
        id,
        kind: range.kind,
        title: note.meta.title,
        from: range.from,
        to: range.to,
        pointCount: new Set(pointIdsIn(note.blocks)).size,
        updated: note.meta.updated,
      });
    }
    return out.sort((a, b) => b.from.localeCompare(a.from) || a.kind.localeCompare(b.kind));
  }

  /** Recent weeks and months (up to 12 each) that have live points, newest first. */
  async periods(folder: string, points: readonly Point[]): Promise<DigestPeriod[]> {
    const counts = new Map<string, number>();
    for (const p of points) {
      if (p.deleted) continue;
      for (const id of [weekOf(p.date), monthOf(p.date)]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const existing = new Set((await this.list(folder)).map((d) => d.id));
    const out: DigestPeriod[] = [];
    for (const [id, n] of counts) {
      const range = periodRange(id);
      if (range) out.push({ id, kind: range.kind, title: range.title, from: range.from, to: range.to, points: n, exists: existing.has(id) });
    }
    const newest = (kind: DigestPeriod['kind']): DigestPeriod[] =>
      out.filter((p) => p.kind === kind).sort((a, b) => b.from.localeCompare(a.from)).slice(0, 12);
    return [...newest('week'), ...newest('month')];
  }

  async read(folder: string, id: string): Promise<NoteFile | null> {
    const raw = await readTextOrNull(await this.path(folder, id));
    return raw === null ? null : parseNote(raw, { folder, subtopic: id });
  }

  /** Writes a digest. A previous digest for the same period is first copied to `.lode/history/`. */
  async write(folder: string, id: string, title: string, blocks: readonly Block[], updated: string): Promise<void> {
    const path = await this.path(folder, id);
    await this.vault.locks.run(path, async () => {
      const previous = await readTextOrNull(path);
      if (previous !== null) {
        // `_digests` cannot clash with a subtopic slug (slugs have no underscore).
        const dir = await this.vault.path(LODE_DIR, 'history', folder, '_digests', id);
        await atomicWrite(join(dir, `${fileStamp(updated)}.md`), previous);
      }
      await atomicWrite(path, serialiseNote({ meta: { folder, subtopic: id, title, updated }, blocks: [...blocks] }));
    });
  }

  /** User-initiated (`digest:delete`). Digests hold only AI text and markers, so this removes the file. */
  async delete(folder: string, id: string): Promise<void> {
    const path = await this.path(folder, id);
    await this.vault.locks.run(path, () => rm(path, { force: true }));
  }
}
