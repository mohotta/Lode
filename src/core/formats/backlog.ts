import type { PointId } from '@shared/types';
import { isPointId } from './ids';
import { renderFrontmatter, splitFrontmatter } from './frontmatter';

/**
 * Backlog day file (HLD §5.2):
 *
 *   ---
 *   date: 2026-10-17
 *   deleted: []
 *   ---
 *   - first line of a point
 *     continuation line ^p-k3x9a2bq
 *
 * The block ID sits at the end of the point's last line (Obsidian block-ID syntax).
 */

export interface BacklogEntry {
  id: PointId;
  text: string;
}

export interface BacklogFile {
  date: string;
  deleted: PointId[];
  entries: BacklogEntry[];
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30 and the like). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const ID_SUFFIX_RE = / \^(p-[0-9a-z]{8})$/;
export const MAX_POINT_LENGTH = 4000;

export function parseBacklog(content: string, fallbackDate: string): BacklogFile {
  const { data, body } = splitFrontmatter(content);
  const date = typeof data.date === 'string' && DATE_RE.test(data.date) ? data.date : fallbackDate;
  const deleted = Array.isArray(data.deleted)
    ? data.deleted.filter((v): v is PointId => typeof v === 'string' && isPointId(v))
    : [];

  const entries: BacklogEntry[] = [];
  let current: string[] | null = null;
  const flush = (): void => {
    if (!current) return;
    const last = current[current.length - 1] ?? '';
    const m = ID_SUFFIX_RE.exec(last);
    // Items without an ID (e.g. typed in another editor) cannot be referenced; they are ignored.
    if (m && m[1] && isPointId(m[1])) {
      current[current.length - 1] = last.slice(0, m.index);
      entries.push({ id: m[1], text: current.join('\n') });
    }
    current = null;
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('- ')) {
      flush();
      current = [line.slice(2)];
    } else if (current && line.startsWith('  ')) {
      current.push(line.slice(2));
    } else {
      flush();
    }
  }
  flush();
  return { date, deleted, entries };
}

/** Normalises user input into storable point text, or throws if unusable. */
export function normalisePointText(input: string): string {
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const text = lines.join('\n');
  if (!text.trim()) throw new Error('A point cannot be empty');
  if (text.length > MAX_POINT_LENGTH) throw new Error(`A point is limited to ${MAX_POINT_LENGTH} characters`);
  // A trailing " ^p-xxxxxxxx" typed by the user would be read back as a block ID.
  if (ID_SUFFIX_RE.test(lines[lines.length - 1] ?? '')) throw new Error('A point cannot end with a block ID');
  return text;
}

export function serialiseEntry(entry: BacklogEntry): string {
  const lines = entry.text.split('\n');
  lines[lines.length - 1] = `${lines[lines.length - 1]} ^${entry.id}`;
  return lines.map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`)).join('\n') + '\n';
}

export function serialiseBacklog(file: BacklogFile): string {
  return (
    renderFrontmatter({ date: file.date, deleted: file.deleted }) + file.entries.map(serialiseEntry).join('')
  );
}

/**
 * Appends one entry to existing file content without rewriting any existing bytes.
 * This is how `backlog:add` writes, so external formatting is preserved.
 */
export function appendEntry(existing: string | null, date: string, entry: BacklogEntry): string {
  const base = existing ?? renderFrontmatter({ date, deleted: [] });
  const sep = base === '' || base.endsWith('\n') ? '' : '\n';
  return base + sep + serialiseEntry(entry);
}
