import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Block, PointId, SubtopicInfo } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import {
  appendBlocks,
  correctedIdsIn,
  duplicatesIn,
  parseNote,
  pointIdsIn,
  retitleNote,
  serialiseNote,
  type NoteFile,
} from '../formats/note';
import { isSlug } from '../formats/slug';
import { LODE_DIR, STAMP_RE, Vault, assertSlug, fileStamp } from './Vault';

/**
 * Reads and writes subtopic notes. Paths are under `<folder>/notes/`, plus the note's
 * snapshots in `.lode/history/` and trashed notes in `.lode/trash/notes/`; never the backlog.
 */
export class NoteRepo {
  constructor(
    private readonly vault: Vault,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private historyDir(folder: string, subtopic: string): Promise<string> {
    assertSlug(folder, 'folder');
    assertSlug(subtopic, 'subtopic');
    return this.vault.path(LODE_DIR, 'history', folder, subtopic);
  }

  private notePath(folder: string, subtopic: string): Promise<string> {
    assertSlug(subtopic, 'subtopic');
    return this.vault.folderPath(folder, 'notes', `${subtopic}.md`);
  }

  async listSlugs(folder: string): Promise<string[]> {
    const dir = await this.vault.folderPath(folder, 'notes');
    try {
      return (await readdir(dir))
        .filter((n) => n.endsWith('.md'))
        .map((n) => n.slice(0, -3))
        .filter(isSlug)
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async read(folder: string, subtopic: string): Promise<NoteFile | null> {
    const content = await readTextOrNull(await this.notePath(folder, subtopic));
    return content === null ? null : parseNote(content, { folder, subtopic });
  }

  async readRaw(folder: string, subtopic: string): Promise<string | null> {
    return readTextOrNull(await this.notePath(folder, subtopic));
  }

  async listSubtopics(folder: string): Promise<SubtopicInfo[]> {
    const out: SubtopicInfo[] = [];
    for (const slug of await this.listSlugs(folder)) {
      const note = await this.read(folder, slug);
      if (note) out.push({ slug, title: note.meta.title, pointCount: new Set(pointIdsIn(note.blocks)).size });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Point ID -> subtopic slugs referencing it. A point is filed iff some note has its marker (HLD §5.4). */
  async filing(folder: string): Promise<Map<PointId, string[]>> {
    const map = new Map<PointId, string[]>();
    for (const slug of await this.listSlugs(folder)) {
      const note = await this.read(folder, slug);
      if (!note) continue;
      for (const id of new Set(pointIdsIn(note.blocks))) {
        const list = map.get(id);
        if (list) list.push(slug);
        else map.set(id, [slug]);
      }
    }
    return map;
  }

  /** Point IDs with an AI correction note anywhere in this folder's notes. */
  async correctedIds(folder: string): Promise<Set<PointId>> {
    const out = new Set<PointId>();
    for (const slug of await this.listSlugs(folder)) {
      const note = await this.read(folder, slug);
      for (const id of note ? correctedIdsIn(note.blocks) : []) out.add(id);
    }
    return out;
  }

  /** Duplicate point ID -> original point ID, across this folder's notes. */
  async duplicates(folder: string): Promise<Map<PointId, PointId>> {
    const out = new Map<PointId, PointId>();
    for (const slug of await this.listSlugs(folder)) {
      const note = await this.read(folder, slug);
      for (const [id, of] of note ? duplicatesIn(note.blocks) : []) out.set(id, of);
    }
    return out;
  }

  /**
   * User-initiated (`notes:delete`): moves the note into `.lode/trash/notes/<folder>/`.
   * Its points become unfiled again, since filing is derived from note markers.
   */
  async trash(folder: string, subtopic: string): Promise<void> {
    const path = await this.notePath(folder, subtopic);
    await this.vault.locks.run(path, async () => {
      if ((await readTextOrNull(path)) === null) throw new Error('Note not found');
      const dir = await this.vault.path(LODE_DIR, 'trash', 'notes', folder);
      await mkdir(dir, { recursive: true });
      await rename(path, await this.vault.path(LODE_DIR, 'trash', 'notes', folder, `${subtopic}-${fileStamp(this.now().toISOString())}.md`));
    });
  }

  /**
   * Regenerate's only write (HLD §6.4). Fails if the note changed since `expected` was read.
   * The previous file is first saved to `.lode/history/<folder>/<subtopic>/<stamp>.md`,
   * where the stamp is the new version's `updated`, so undo can tell whether it still applies.
   */
  async replaceBlocks(
    folder: string,
    subtopic: string,
    expected: string,
    blocks: readonly Block[],
    updated: string,
  ): Promise<void> {
    const path = await this.notePath(folder, subtopic);
    await this.vault.locks.run(path, async () => {
      const current = await readTextOrNull(path);
      if (current === null) throw new Error('The note was deleted while regenerating; nothing was written.');
      if (current !== expected) throw new Error('The note changed while regenerating; nothing was written. Try again.');
      const note = parseNote(current, { folder, subtopic });
      const dir = await this.historyDir(folder, subtopic);
      await atomicWrite(join(dir, `${fileStamp(updated)}.md`), current);
      await atomicWrite(path, serialiseNote({ meta: { ...note.meta, updated }, blocks: [...blocks] }));
    });
  }

  private async snapshotFor(folder: string, subtopic: string, updated: string): Promise<string | null> {
    if (!updated) return null;
    const stamp = fileStamp(updated);
    if (!STAMP_RE.test(stamp)) return null;
    const file = join(await this.historyDir(folder, subtopic), `${stamp}.md`);
    return (await readTextOrNull(file)) === null ? null : file;
  }

  /** True when the note is exactly what a Regenerate wrote, so undo would lose nothing else. */
  async canUndo(folder: string, subtopic: string, note: NoteFile): Promise<boolean> {
    return (await this.snapshotFor(folder, subtopic, note.meta.updated)) !== null;
  }

  /** User-initiated (`notes:undoRegenerate`): restores the version saved before the last Regenerate. */
  async undoRegenerate(folder: string, subtopic: string): Promise<void> {
    const path = await this.notePath(folder, subtopic);
    await this.vault.locks.run(path, async () => {
      const current = await readTextOrNull(path);
      if (current === null) throw new Error('Note not found');
      const snap = await this.snapshotFor(folder, subtopic, parseNote(current, { folder, subtopic }).meta.updated);
      if (!snap) throw new Error('Nothing to undo: the note has changed since it was regenerated.');
      const previous = await readTextOrNull(snap);
      if (previous === null) throw new Error('Nothing to undo.');
      // Keep any title the user set after regenerating.
      const title = parseNote(current, { folder, subtopic }).meta.title;
      const prevMeta = parseNote(previous, { folder, subtopic }).meta;
      await atomicWrite(path, retitleNote(previous, { ...prevMeta, title }));
      await rm(snap, { force: true });
    });
  }

  /**
   * User-initiated rename (`notes:rename`): changes the frontmatter title only.
   * Slug, path and every block stay exactly as they were.
   */
  async rename(folder: string, subtopic: string, title: string): Promise<SubtopicInfo> {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Title cannot be empty');
    if (clean.length > 120) throw new Error('Title is limited to 120 characters');
    const path = await this.notePath(folder, subtopic);
    return this.vault.locks.run(path, async () => {
      const existing = await readTextOrNull(path);
      if (existing === null) throw new Error('Note not found');
      const note = parseNote(existing, { folder, subtopic });
      await atomicWrite(path, retitleNote(existing, { ...note.meta, title: clean }));
      return { slug: subtopic, title: clean, pointCount: new Set(pointIdsIn(note.blocks)).size };
    });
  }

  /** Appends blocks atomically. Existing blocks are left byte-for-byte as they were. */
  async append(
    folder: string,
    subtopic: string,
    title: string,
    blocks: readonly Block[],
    updated: string,
  ): Promise<void> {
    const path = await this.notePath(folder, subtopic);
    await this.vault.locks.run(path, async () => {
      const existing = await readTextOrNull(path);
      await atomicWrite(path, appendBlocks(existing, { folder, subtopic, title, updated }, blocks));
    });
  }
}
