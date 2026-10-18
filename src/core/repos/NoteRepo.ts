import { readdir } from 'node:fs/promises';
import type { Block, PointId, SubtopicInfo } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import { appendBlocks, correctedIdsIn, parseNote, pointIdsIn, retitleNote, type NoteFile } from '../formats/note';
import { isSlug } from '../formats/slug';
import { Vault, assertSlug } from './Vault';

/** Reads and appends subtopic notes. All paths are under `<folder>/notes/`, never the backlog. */
export class NoteRepo {
  constructor(private readonly vault: Vault) {}

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
