import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { TrashItem } from '@shared/types';
import { readTextOrNull } from '../fs/readText';
import { parseNote } from '../formats/note';
import { isSlug, uniqueSlug } from '../formats/slug';
import { LODE_DIR, STAMP_RE, Vault, stampToIso } from './Vault';

/**
 * The vault trash (`.lode/trash/`). Deleting moves things here; nothing is removed
 * from disk until the user empties the trash.
 *
 *   .lode/trash/<folder>-<stamp>/                  a deleted folder (whole directory)
 *   .lode/trash/notes/<folder>/<subtopic>-<stamp>.md a deleted note
 */

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
const FOLDER_ITEM_RE = new RegExp(`^(${SLUG})-(${STAMP})$`);
const NOTE_FILE_RE = new RegExp(`^(${SLUG})-(${STAMP})\\.md$`);
/** Every valid trash item ID. IDs come from the renderer, so they are checked before any fs call. */
export const TRASH_ID_RE = new RegExp(`^(?:${SLUG}-${STAMP}|notes/${SLUG}/${SLUG}-${STAMP}\\.md)$`);

const FolderJson = z.object({ title: z.string() }).loose();

async function dirNames(path: string): Promise<{ name: string; dir: boolean }[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export class TrashRepo {
  constructor(private readonly vault: Vault) {}

  private path(...segments: string[]): Promise<string> {
    return this.vault.path(LODE_DIR, 'trash', ...segments);
  }

  async list(): Promise<TrashItem[]> {
    const out: TrashItem[] = [];
    for (const e of await dirNames(await this.path())) {
      const m = FOLDER_ITEM_RE.exec(e.name);
      if (!e.dir || !m?.[1] || !m[2] || !STAMP_RE.test(m[2])) continue;
      let title = m[1];
      try {
        const raw = await readTextOrNull(await this.path(e.name, 'folder.json'));
        if (raw) title = FolderJson.parse(JSON.parse(raw)).title || title;
      } catch {
        // Unreadable folder.json: fall back to the slug.
      }
      out.push({ id: e.name, kind: 'folder', title, folder: m[1], deletedAt: stampToIso(m[2]) });
    }
    for (const f of await dirNames(await this.path('notes'))) {
      if (!f.dir || !isSlug(f.name)) continue;
      for (const n of await dirNames(await this.path('notes', f.name))) {
        const m = NOTE_FILE_RE.exec(n.name);
        if (n.dir || !m?.[1] || !m[2]) continue;
        const raw = await readTextOrNull(await this.path('notes', f.name, n.name));
        const title = raw ? parseNote(raw, { folder: f.name, subtopic: m[1] }).meta.title : m[1];
        out.push({ id: `notes/${f.name}/${n.name}`, kind: 'note', title, folder: f.name, deletedAt: stampToIso(m[2]) });
      }
    }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Moves an item back. A name clash gets a fresh slug instead of overwriting anything. */
  async restore(id: string): Promise<TrashItem> {
    const item = (await this.list()).find((i) => i.id === id);
    if (!TRASH_ID_RE.test(id) || !item) throw new Error('Not in the trash');
    const from = await this.path(...id.split('/'));
    if (item.kind === 'folder') {
      const taken = new Set((await readdir(this.vault.root)).map((n) => n.toLowerCase()));
      taken.add(LODE_DIR);
      const slug = uniqueSlug(item.folder, taken);
      await rename(from, await this.vault.folderPath(slug));
      return { ...item, folder: slug };
    }
    if (!(await this.exists(await this.vault.folderPath(item.folder, 'folder.json')))) {
      throw new Error(`Its folder "${item.folder}" is not in this vault. Restore the folder first.`);
    }
    const subtopic = NOTE_FILE_RE.exec(id.split('/')[2] ?? '')?.[1] ?? 'restored-note';
    const notesDir = await this.vault.folderPath(item.folder, 'notes');
    await mkdir(notesDir, { recursive: true });
    const taken = new Set((await dirNames(notesDir)).map((e) => e.name.replace(/\.md$/, '')));
    const slug = uniqueSlug(subtopic, taken);
    await rename(from, await this.vault.folderPath(item.folder, 'notes', `${slug}.md`));
    return item;
  }

  /** Permanently deletes one item, or everything when `id` is omitted. */
  async purge(id?: string): Promise<void> {
    if (id === undefined) {
      await rm(await this.path(), { recursive: true, force: true });
      return;
    }
    if (!TRASH_ID_RE.test(id)) throw new Error('Not in the trash');
    await rm(await this.path(...id.split('/')), { recursive: true, force: true });
  }
}
