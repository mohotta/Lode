import { z } from 'zod';
import type { Point, PointId, ReviewItem, ReviewStage } from '@shared/types';
import { atomicWrite } from '../fs/atomicWrite';
import { readTextOrNull } from '../fs/readText';
import { LODE_DIR, Vault, localDate } from './Vault';

/**
 * Review mode (FR-27, HLD §6.5). Which points are due is computed from point dates;
 * only "reviewed" marks are stored, in `.lode/review.json`:
 *
 *   { "version": 1, "reviewed": { "p-k3x9a2bq": { "1": "2026-10-18", "7": "2026-10-24" } } }
 *
 * Each stage is a window rather than an exact day, so a few days away from the app do
 * not lose reviews, while points older than the last window never flood the list.
 */
export const STAGES: readonly { stage: ReviewStage; from: number; to: number }[] = [
  { stage: 1, from: 1, to: 6 },
  { stage: 7, from: 7, to: 29 },
  { stage: 30, from: 30, to: 59 },
];

const DAY_MS = 86_400_000;

/** Whole days from `date` to `today` (both local YYYY-MM-DD). */
export function ageInDays(date: string, today: string): number {
  const [y1, m1, d1] = date.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

export function stageFor(date: string, today: string): ReviewStage | null {
  const age = ageInDays(date, today);
  return STAGES.find((s) => age >= s.from && age <= s.to)?.stage ?? null;
}

const StageKey = z.enum(['1', '7', '30']);
const ReviewFile = z.object({
  version: z.literal(1),
  reviewed: z.record(z.string().regex(/^p-[0-9a-z]{8}$/), z.partialRecord(StageKey, z.string())),
});
type ReviewData = z.infer<typeof ReviewFile>;

export interface ReviewSource {
  folders: readonly { slug: string; title: string }[];
  points(folder: string): Promise<readonly Point[]>;
  filing(folder: string): Promise<ReadonlyMap<PointId, readonly string[]>>;
  subtopics(folder: string): Promise<readonly { slug: string; title: string }[]>;
}

export class ReviewRepo {
  constructor(
    private readonly vault: Vault,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private path(): Promise<string> {
    return this.vault.path(LODE_DIR, 'review.json');
  }

  private async read(): Promise<ReviewData> {
    const raw = await readTextOrNull(await this.path());
    if (!raw) return { version: 1, reviewed: {} };
    try {
      return ReviewFile.parse(JSON.parse(raw));
    } catch {
      // A corrupt file only costs review marks; points are untouched. Start fresh.
      return { version: 1, reviewed: {} };
    }
  }

  /** Points due for review today across the given folders, oldest stage first. */
  async listDue(src: ReviewSource): Promise<ReviewItem[]> {
    const today = localDate(this.now());
    const { reviewed } = await this.read();
    const out: ReviewItem[] = [];
    for (const f of src.folders) {
      const [points, filing, subs] = await Promise.all([src.points(f.slug), src.filing(f.slug), src.subtopics(f.slug)]);
      const titles = new Map(subs.map((s) => [s.slug, s.title]));
      for (const p of points) {
        if (p.deleted) continue;
        const stage = stageFor(p.date, today);
        if (stage === null || reviewed[p.id]?.[String(stage) as '1' | '7' | '30']) continue;
        out.push({
          id: p.id,
          text: p.text,
          date: p.date,
          folder: f.slug,
          folderTitle: f.title,
          stage,
          filedUnder: (filing.get(p.id) ?? []).map((slug) => ({ slug, title: titles.get(slug) ?? slug })),
        });
      }
    }
    return out.sort((a, b) => b.stage - a.stage || a.date.localeCompare(b.date));
  }

  /** User-initiated (`review:mark`). Records today as the review date for each (point, stage). */
  async mark(items: readonly { id: PointId; stage: ReviewStage }[]): Promise<void> {
    const path = await this.path();
    const today = localDate(this.now());
    await this.vault.locks.run(path, async () => {
      const data = await this.read();
      for (const { id, stage } of items) {
        data.reviewed[id] = { ...data.reviewed[id], [String(stage)]: today };
      }
      await atomicWrite(path, JSON.stringify(data, null, 2) + '\n');
    });
  }
}
