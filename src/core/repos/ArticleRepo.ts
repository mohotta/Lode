import { randomInt } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArticleInfo, Block, PointId } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import { renderFrontmatter, splitFrontmatter } from '../formats/frontmatter';
import { extractSources, parseNoteBody, pointIdsIn, serialiseBlock } from '../formats/note';
import { isSlug, slugify, uniqueSlug } from '../formats/slug';
import { sanitizeLlmText } from '../generation/sanitize';
import { LODE_DIR, STAMP_RE, Vault, assertSlug, fileStamp } from './Vault';

export interface ArticleMeta {
  folder: string;
  slug: string;
  title: string;
  updated: string;
  /** Subtopic slugs the note was written from. */
  subtopics: string[];
  /** Extra topics the user asked for. */
  topics: string[];
}

export interface ArticleFile {
  meta: ArticleMeta;
  blocks: Block[];
}

/** One block of a hand edit (`article:save`). Text without `body` keeps that block unchanged. */
export type ArticleEdit = { kind: 'point'; id: PointId } | { kind: 'text'; id?: string; body?: string };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function parseArticle(content: string, fallback: { folder: string; slug: string }): ArticleFile {
  const { data, body } = splitFrontmatter(content);
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  return {
    meta: {
      folder: str(data.folder, fallback.folder),
      slug: str(data.article, fallback.slug),
      title: str(data.title, fallback.slug),
      updated: str(data.updated),
      subtopics: strings(data.subtopics).filter(isSlug),
      topics: strings(data.topics),
    },
    blocks: parseNoteBody(body),
  };
}

export function serialiseArticle(a: ArticleFile): string {
  const m = a.meta;
  const head = renderFrontmatter({
    folder: m.folder,
    article: m.slug,
    title: m.title,
    updated: m.updated,
    subtopics: m.subtopics,
    topics: m.topics,
  });
  const body = a.blocks.map(serialiseBlock).join('\n\n');
  return `${head}\n${body}${body ? '\n' : ''}`;
}

function blockId(): string {
  const a = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'b-';
  for (let i = 0; i < 8; i++) s += a[randomInt(a.length)];
  return s;
}

/**
 * Notes (composed articles): `<folder>/articles/<slug>.md`, in the note format with point
 * markers. They live outside `notes/`, so a note never counts as filing a point. Every
 * rewrite (AI or by hand) first saves the previous file to `.lode/history/<folder>/_articles/`.
 */
export class ArticleRepo {
  constructor(
    private readonly vault: Vault,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private path(folder: string, slug: string): Promise<string> {
    assertSlug(slug, 'note');
    return this.vault.folderPath(folder, 'articles', `${slug}.md`);
  }

  private historyDir(folder: string, slug: string): Promise<string> {
    assertSlug(folder, 'folder');
    assertSlug(slug, 'note');
    // `_articles` cannot clash with a subtopic slug (slugs have no underscore).
    return this.vault.path(LODE_DIR, 'history', folder, '_articles', slug);
  }

  async listSlugs(folder: string): Promise<string[]> {
    try {
      return (await readdir(await this.vault.folderPath(folder, 'articles')))
        .filter((n) => n.endsWith('.md'))
        .map((n) => n.slice(0, -3))
        .filter(isSlug)
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async list(folder: string): Promise<ArticleInfo[]> {
    const out: ArticleInfo[] = [];
    for (const slug of await this.listSlugs(folder)) {
      const a = await this.read(folder, slug);
      if (!a) continue;
      out.push({
        slug,
        title: a.meta.title,
        updated: a.meta.updated,
        pointCount: new Set(pointIdsIn(a.blocks)).size,
        subtopics: a.meta.subtopics,
        topics: a.meta.topics,
      });
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  }

  async read(folder: string, slug: string): Promise<ArticleFile | null> {
    const raw = await this.readRaw(folder, slug);
    return raw === null ? null : parseArticle(raw, { folder, slug });
  }

  async readRaw(folder: string, slug: string): Promise<string | null> {
    return readTextOrNull(await this.path(folder, slug));
  }

  /** Writes a new note under a slug made from its title; returns the slug. */
  async create(
    folder: string,
    meta: { title: string; subtopics: string[]; topics: string[] },
    blocks: readonly Block[],
    updated: string,
  ): Promise<string> {
    const dir = await this.vault.folderPath(folder, 'articles');
    return this.vault.locks.run(dir, async () => {
      const slug = uniqueSlug(slugify(meta.title) || 'note', new Set(await this.listSlugs(folder)));
      const path = await this.path(folder, slug);
      await atomicWrite(path, serialiseArticle({ meta: { folder, slug, updated, ...meta }, blocks: [...blocks] }));
      return slug;
    });
  }

  /**
   * Replaces the note if it still equals `expected` (compare-and-swap), keeping a snapshot
   * named after the new `updated` stamp so undo can tell whether it still applies.
   */
  async replace(
    folder: string,
    slug: string,
    expected: string,
    next: (current: ArticleFile) => ArticleFile,
    updated: string,
  ): Promise<ArticleFile> {
    const path = await this.path(folder, slug);
    return this.vault.locks.run(path, async () => {
      const current = await readTextOrNull(path);
      if (current === null) throw new Error('The note was deleted; nothing was written.');
      if (current !== expected) throw new Error('The note changed in the meantime; nothing was written. Try again.');
      const file = next(parseArticle(current, { folder, slug }));
      const out: ArticleFile = { meta: { ...file.meta, folder, slug, updated }, blocks: file.blocks };
      await atomicWrite(join(await this.historyDir(folder, slug), `${fileStamp(updated)}.md`), current);
      await atomicWrite(path, serialiseArticle(out));
      return out;
    });
  }

  /**
   * User-initiated (`article:save`): the hand-edited note. Points can be moved or removed but
   * not added, and their text is never stored here. Changed or new text is marked as the user's.
   */
  async saveEdits(folder: string, slug: string, opts: { expected: string; title?: string; blocks: readonly ArticleEdit[] }): Promise<ArticleFile> {
    const raw = await this.readRaw(folder, slug);
    if (raw === null) throw new Error('Note not found');
    const current = parseArticle(raw, { folder, slug });
    if (current.meta.updated !== opts.expected) throw new Error('The note changed since you started editing. Copy your changes, reopen it and try again.');
    const at = this.now().toISOString();
    const known = new Set(pointIdsIn(current.blocks));
    const byId = new Map(current.blocks.flatMap((b) => (b.kind === 'llm' ? [[b.id, b] as const] : [])));
    const seen = new Set<string>();
    const blocks: Block[] = [];
    for (const e of opts.blocks) {
      if (e.kind === 'point') {
        if (!known.has(e.id)) throw new Error('A note can only keep the points it already has.');
        if (!seen.has(e.id)) blocks.push({ kind: 'point', id: e.id });
        seen.add(e.id);
        continue;
      }
      const old = e.id ? byId.get(e.id) : undefined;
      if (e.body === undefined) {
        if (!old || seen.has(old.id)) throw new Error('Unknown block in edit.');
        blocks.push(old);
        seen.add(old.id);
        continue;
      }
      // Same neutralising as model text, so typed text cannot open a block or forge a point marker.
      const body = sanitizeLlmText(e.body);
      if (!body) continue;
      blocks.push({ kind: 'llm', id: old && !seen.has(old.id) ? old.id : blockId(), model: 'you', at, body, sources: extractSources(body), byUser: true });
      if (old) seen.add(old.id);
    }
    const title = opts.title?.replace(/\s+/g, ' ').trim();
    if (opts.title !== undefined && !title) throw new Error('Title cannot be empty');
    return this.replace(folder, slug, raw, (a) => ({ meta: { ...a.meta, ...(title ? { title } : {}) }, blocks }), at);
  }

  private async snapshotFor(folder: string, slug: string, updated: string): Promise<string | null> {
    const stamp = updated ? fileStamp(updated) : '';
    if (!STAMP_RE.test(stamp)) return null;
    const file = join(await this.historyDir(folder, slug), `${stamp}.md`);
    return (await readTextOrNull(file)) === null ? null : file;
  }

  async canUndo(folder: string, slug: string, a: ArticleFile): Promise<boolean> {
    return (await this.snapshotFor(folder, slug, a.meta.updated)) !== null;
  }

  /** User-initiated (`article:undo`): restores the version before the last rewrite or edit. */
  async undo(folder: string, slug: string): Promise<void> {
    const path = await this.path(folder, slug);
    await this.vault.locks.run(path, async () => {
      const current = await readTextOrNull(path);
      if (current === null) throw new Error('Note not found');
      const snap = await this.snapshotFor(folder, slug, parseArticle(current, { folder, slug }).meta.updated);
      const previous = snap ? await readTextOrNull(snap) : null;
      if (!snap || previous === null) throw new Error('Nothing to undo.');
      await atomicWrite(path, previous);
      await rm(snap, { force: true });
    });
  }

  /** User-initiated (`article:delete`). A copy is kept in the note's history folder. */
  async delete(folder: string, slug: string): Promise<void> {
    const path = await this.path(folder, slug);
    await this.vault.locks.run(path, async () => {
      const current = await readTextOrNull(path);
      if (current === null) return;
      await atomicWrite(join(await this.historyDir(folder, slug), `deleted-${fileStamp(this.now().toISOString())}.md`), current);
      await rm(path, { force: true });
    });
  }
}
