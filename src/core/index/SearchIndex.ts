import { readdir, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type { SearchHit } from '@shared/types';
import { readTextOrNull } from '../fs/readText';
import { DATE_RE, parseBacklog } from '../formats/backlog';
import { parseNote } from '../formats/note';
import { isSlug } from '../formats/slug';
import { LODE_DIR, Vault } from '../repos/Vault';

/**
 * Full-text search (FR-28, HLD §10) over backlog points and note/digest AI text, using
 * the SQLite built into Node (`node:sqlite`, FTS5), so there is no native module to rebuild.
 *
 * The index (`.lode/index.sqlite`) is disposable: it caches what the markdown files say.
 * Before each query, files whose mtime or size changed are re-read, so edits made outside
 * Lode are picked up without a file watcher. Deleting the file just triggers a rebuild.
 */

const SCHEMA_VERSION = '1';

type Kind = 'point' | 'ai' | 'correction';

interface Row {
  kind: Kind;
  folder: string;
  /** Point ID, note slug or digest ID. */
  ref: string;
  /** Point date (points only). */
  date: string;
  /** Note title, or '1' for a deleted point. */
  extra: string;
  digest: 0 | 1;
  text: string;
}

const LINK_RE = /\[([^\]\n]*)\]\((?:https?:\/\/[^\s)]+)\)/g;

/** Turns a user query into a safe FTS5 expression: every word, as a quoted prefix, AND-ed. */
export function toFtsQuery(q: string): string | null {
  const words = q.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return null;
  return words
    .slice(0, 12)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

export class SearchIndex {
  private db: DatabaseSync | null = null;

  constructor(
    private readonly vault: Vault,
    private readonly folderTitles: () => Promise<ReadonlyMap<string, string>>,
  ) {}

  private async open(): Promise<DatabaseSync> {
    if (this.db) return this.db;
    const path = await this.vault.path(LODE_DIR, 'index.sqlite');
    let db: DatabaseSync;
    try {
      db = this.create(path);
    } catch {
      // Corrupt or from an incompatible build: it is only a cache, so start over.
      await rm(path, { force: true });
      db = this.create(path);
    }
    this.db = db;
    return db;
  }

  private create(path: string): DatabaseSync {
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined;
    if (version?.value !== SCHEMA_VERSION) {
      db.exec(`
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS fts;
        CREATE TABLE files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);
        CREATE VIRTUAL TABLE fts USING fts5(
          text, kind UNINDEXED, folder UNINDEXED, path UNINDEXED, ref UNINDEXED,
          date UNINDEXED, extra UNINDEXED, digest UNINDEXED,
          tokenize = 'porter unicode61'
        );
      `);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);
    }
    return db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  /** Every indexable file, as a vault-relative path with its folder. */
  private async files(): Promise<{ rel: string; folder: string; area: 'backlog' | 'notes' | 'digests' }[]> {
    const out: { rel: string; folder: string; area: 'backlog' | 'notes' | 'digests' }[] = [];
    for (const e of await readdir(this.vault.root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === LODE_DIR || !isSlug(e.name)) continue;
      for (const area of ['backlog', 'notes', 'digests'] as const) {
        let names: string[];
        try {
          names = await readdir(await this.vault.folderPath(e.name, area));
        } catch {
          continue;
        }
        for (const n of names) {
          if (!n.endsWith('.md')) continue;
          const base = n.slice(0, -3);
          if (area === 'backlog' ? !DATE_RE.test(base) : !isSlug(base) && !/^\d{4}-(W\d{2}|\d{2})$/.test(base)) continue;
          out.push({ rel: `${e.name}/${area}/${n}`, folder: e.name, area });
        }
      }
    }
    return out;
  }

  private rowsFor(content: string, folder: string, area: 'backlog' | 'notes' | 'digests', base: string): Row[] {
    if (area === 'backlog') {
      const day = parseBacklog(content, base);
      const deleted = new Set(day.deleted);
      return day.entries.map((e) => ({
        kind: 'point',
        folder,
        ref: e.id,
        date: day.date,
        extra: deleted.has(e.id) ? '1' : '',
        digest: 0,
        text: e.text,
      }));
    }
    const note = parseNote(content, { folder, subtopic: base });
    const rows: Row[] = [];
    for (const b of note.blocks) {
      // Repeat markers carry fixed text; raw blocks are not AI text. Point text lives in the backlog rows.
      if (b.kind !== 'llm' || b.duplicate) continue;
      rows.push({
        kind: b.correctionFor ? 'correction' : 'ai',
        folder,
        ref: base,
        date: '',
        extra: note.meta.title,
        digest: area === 'digests' ? 1 : 0,
        text: b.body.replace(LINK_RE, '$1'),
      });
    }
    return rows;
  }

  /** Re-reads files whose mtime or size changed and drops rows for files that are gone. */
  async sync(): Promise<void> {
    const db = await this.open();
    const known = new Map(
      (db.prepare('SELECT path, mtime, size FROM files').all() as { path: string; mtime: number; size: number }[]).map(
        (r) => [r.path, r],
      ),
    );
    const changed: { rel: string; folder: string; area: 'backlog' | 'notes' | 'digests'; mtime: number; size: number; content: string }[] = [];
    const seen = new Set<string>();
    for (const f of await this.files()) {
      seen.add(f.rel);
      const abs = await this.vault.path(...f.rel.split('/'));
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue;
      }
      const hit = known.get(f.rel);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) continue;
      const content = await readTextOrNull(abs);
      if (content !== null) changed.push({ ...f, mtime: st.mtimeMs, size: st.size, content });
    }
    const gone = [...known.keys()].filter((p) => !seen.has(p));
    if (changed.length === 0 && gone.length === 0) return;

    const delRows = db.prepare('DELETE FROM fts WHERE path = ?');
    const delFile = db.prepare('DELETE FROM files WHERE path = ?');
    const putFile = db.prepare('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)');
    const putRow = db.prepare(
      'INSERT INTO fts (text, kind, folder, path, ref, date, extra, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    try {
      for (const p of gone) {
        delRows.run(p);
        delFile.run(p);
      }
      for (const f of changed) {
        delRows.run(f.rel);
        const base = f.rel.slice(f.rel.lastIndexOf('/') + 1, -3);
        for (const r of this.rowsFor(f.content, f.folder, f.area, base)) {
          putRow.run(r.text, r.kind, r.folder, f.rel, r.ref, r.date, r.extra, r.digest);
        }
        putFile.run(f.rel, f.mtime, f.size);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  async query(q: string, limit = 50): Promise<SearchHit[]> {
    const match = toFtsQuery(q);
    if (!match) return [];
    await this.sync();
    const db = await this.open();
    const rows = db
      .prepare(
        `SELECT kind, folder, ref, date, extra, digest,
                snippet(fts, 0, char(1), char(2), '…', 16) AS snip
           FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as { kind: Kind; folder: string; ref: string; date: string; extra: string; digest: number; snip: string }[];
    const titles = await this.folderTitles();
    return rows.map((r): SearchHit => {
      const folderTitle = titles.get(r.folder) ?? r.folder;
      return r.kind === 'point'
        ? {
            kind: 'point',
            id: r.ref as `p-${string}`,
            folder: r.folder,
            folderTitle,
            date: r.date,
            deleted: r.extra === '1',
            snippet: r.snip,
          }
        : {
            kind: 'ai',
            folder: r.folder,
            folderTitle,
            note: r.ref,
            noteTitle: r.extra || r.ref,
            digest: r.digest === 1,
            correction: r.kind === 'correction',
            snippet: r.snip,
          };
    });
  }
}
