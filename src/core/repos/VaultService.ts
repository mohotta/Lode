import { mkdir, readdir, rename } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import type { FolderInfo } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import { isSlug, slugify, uniqueSlug } from '../formats/slug';
import { LODE_DIR, Vault } from './Vault';

const FolderJson = z.object({ title: z.string().min(1).max(200), createdAt: z.string() });
const VaultConfig = z.object({ version: z.literal(1), createdAt: z.string() });

export const MAX_TITLE = 200;

function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Title cannot be empty');
  if (t.length > MAX_TITLE) throw new Error(`Title is limited to ${MAX_TITLE} characters`);
  return t;
}

export class VaultService {
  constructor(
    readonly vault: Vault,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates `.lode/config.json` if missing. Safe to call on an existing vault. */
  async init(): Promise<void> {
    const cfgPath = await this.vault.path(LODE_DIR, 'config.json');
    const existing = await readTextOrNull(cfgPath);
    if (existing !== null) {
      VaultConfig.parse(JSON.parse(existing));
      return;
    }
    await atomicWrite(cfgPath, JSON.stringify({ version: 1, createdAt: this.now().toISOString() }, null, 2) + '\n');
  }

  name(): string {
    return basename(this.vault.root);
  }

  async listFolders(): Promise<FolderInfo[]> {
    const entries = await readdir(this.vault.root, { withFileTypes: true });
    const out: FolderInfo[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name === LODE_DIR || !isSlug(e.name)) continue;
      const raw = await readTextOrNull(await this.vault.folderPath(e.name, 'folder.json'));
      if (raw === null) continue;
      const parsed = FolderJson.safeParse(JSON.parse(raw));
      if (parsed.success) out.push({ slug: e.name, ...parsed.data });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async createFolder(title: string): Promise<FolderInfo> {
    const clean = cleanTitle(title);
    const taken = new Set((await readdir(this.vault.root)).map((n) => n.toLowerCase()));
    taken.add(LODE_DIR);
    const slug = uniqueSlug(slugify(clean), taken);
    const dir = await this.vault.folderPath(slug);
    await mkdir(dir);
    await mkdir(await this.vault.folderPath(slug, 'backlog'));
    await mkdir(await this.vault.folderPath(slug, 'notes'));
    const info = { title: clean, createdAt: this.now().toISOString() };
    await atomicWrite(await this.vault.folderPath(slug, 'folder.json'), JSON.stringify(info, null, 2) + '\n');
    return { slug, ...info };
  }

  /** Renames the display title only. The slug (and so every path) stays stable. */
  async renameFolder(slug: string, title: string): Promise<FolderInfo> {
    await this.vault.assertFolderExists(slug);
    const path = await this.vault.folderPath(slug, 'folder.json');
    const current = FolderJson.parse(JSON.parse((await readTextOrNull(path)) ?? '{}'));
    const next = { ...current, title: cleanTitle(title) };
    await atomicWrite(path, JSON.stringify(next, null, 2) + '\n');
    return { slug, ...next };
  }

  /** Moves the folder into `.lode/trash/` rather than deleting user data outright. */
  async deleteFolder(slug: string): Promise<void> {
    await this.vault.assertFolderExists(slug);
    const trash = await this.vault.path(LODE_DIR, 'trash');
    await mkdir(trash, { recursive: true });
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    await rename(await this.vault.folderPath(slug), await this.vault.path(LODE_DIR, 'trash', `${slug}-${stamp}`));
  }
}
