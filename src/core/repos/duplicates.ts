import type { Point } from '@shared/types';

/**
 * Local (on-device) duplicate detection for `backlog:add`. No network: semantic
 * duplicates are left to the model during Generate (HLD §6.1 `duplicates`).
 */

const STOP = new Set(
  'a an the and or but of to in on at for by with from as is are was were be been it its this that these those into than then so if do does can will just'.split(
    ' ',
  ),
);

/** Lowercase, markdown/punctuation stripped, whitespace collapsed. */
export function normaliseForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~#>|[\](){}"'“”‘’.,;:!?\\/=+<-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(norm: string): string[] {
  return norm.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
}

function trigrams(norm: string): Map<string, number> {
  const s = ` ${norm} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let total = 0;
  for (const [g, n] of a) {
    inter += Math.min(n, b.get(g) ?? 0);
    total += n;
  }
  for (const n of b.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

export interface DuplicateMatch {
  point: Point;
  /** Same words regardless of case, punctuation, markdown or order. */
  exact: boolean;
  score: number;
}

/** Score at or above which a point is treated as a likely repeat. */
export const NEAR_THRESHOLD = 0.8;

/** Best match for `text` among `points` (deleted points ignored), or null when nothing is close. */
export function findDuplicate(text: string, points: readonly Point[]): DuplicateMatch | null {
  const norm = normaliseForCompare(text);
  if (!norm) return null;
  const w = words(norm);
  const sorted = [...w].sort().join(' ');
  const grams = trigrams(norm);
  let best: DuplicateMatch | null = null;
  for (const p of points) {
    if (p.deleted) continue;
    const pn = normaliseForCompare(p.text);
    const pw = words(pn);
    if (pn === norm || (w.length > 0 && [...pw].sort().join(' ') === sorted)) {
      return { point: p, exact: true, score: 1 };
    }
    // Very short points share words by chance; require a little substance before calling it a repeat.
    if (Math.min(w.length, pw.length) < 3) continue;
    const score = Math.max(jaccard(w, pw), dice(grams, trigrams(pn)));
    if (score >= NEAR_THRESHOLD && (!best || score > best.score)) best = { point: p, exact: false, score };
  }
  return best;
}
