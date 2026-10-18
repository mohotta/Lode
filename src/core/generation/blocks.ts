import type { Block, PointId } from '@shared/types';
import { extractSources } from '../formats/note';
import type { ValidAssignment, ValidCorrection, ValidDuplicate } from './validate';

export interface NotePlan {
  slug: string;
  title: string;
  isNew: boolean;
  blocks: Block[];
}

export interface BlockMeta {
  model: string;
  at: string;
  newBlockId(): string;
}

export function renderLlmBody(a: ValidAssignment): string {
  const parts: string[] = [];
  if (a.explanation) parts.push(a.explanation);
  if (a.additions.length) {
    const items = a.additions.map((add) => {
      const cites = add.sources.map((s) => `[${s.title}](${s.url})`).join(' ');
      return `- ${add.text}${add.unsourced ? ' *(unsourced)*' : ` ${cites}`}`;
    });
    parts.push(`Also worth knowing:\n${items.join('\n')}`);
  }
  return parts.join('\n\n');
}

export function renderCorrectionBody(c: ValidCorrection): string {
  const cites = c.unsourced ? ' *(unsourced)*' : ` ${c.sources.map((s) => `[${s.title}](${s.url})`).join(' ')}`;
  return `${c.issue}\n\n**Correct:** ${c.correction}${cites}`;
}

function correctionBlock(c: ValidCorrection, meta: BlockMeta): Block {
  const body = renderCorrectionBody(c);
  return {
    kind: 'llm',
    id: meta.newBlockId(),
    model: meta.model,
    at: meta.at,
    body,
    sources: extractSources(body),
    correctionFor: c.pointId,
  };
}

/** Fixed text written by Lode, not the model; the renderer shows its own label from the attributes. */
export const DUPLICATE_BODY = 'Repeats an earlier point.';

function duplicateBlock(id: PointId, of: PointId, meta: BlockMeta): Block {
  return {
    kind: 'llm',
    id: meta.newBlockId(),
    model: meta.model,
    at: meta.at,
    body: DUPLICATE_BODY,
    sources: [],
    duplicate: { id, of },
  };
}

export interface DuplicatePlacement {
  duplicates: readonly ValidDuplicate[];
  /** Subtopics an already-filed point is in. */
  filedUnder(id: PointId): readonly string[];
  /** Title of an existing subtopic. */
  titleOf(slug: string): string;
}

/**
 * Groups assignments by subtopic and lays out blocks to append: the point markers,
 * then the AI block that explains them (HLD §6.3 step 2).
 *
 * A repeat is filed once, next to the point it repeats (in that point's first subtopic),
 * as its marker plus a `kind=duplicate` block, instead of getting its own explanation.
 */
export function planNotes(
  assignments: readonly ValidAssignment[],
  alreadyIn: (slug: string) => ReadonlySet<PointId>,
  meta: BlockMeta,
  corrections: readonly ValidCorrection[] = [],
  dups: DuplicatePlacement = { duplicates: [], filedUnder: () => [], titleOf: (s) => s },
): NotePlan[] {
  const correctionFor = new Map(corrections.map((c) => [c.pointId, c]));
  const dupOf = new Map(dups.duplicates.map((d) => [d.pointId, d.duplicateOf]));
  // Where each repeat goes: the original's subtopic in this run, else where it is already filed.
  const dupTarget = new Map<PointId, string>();
  for (const [id, of] of dupOf) {
    const inRun = assignments.find((a) => a.pointIds.includes(of))?.subtopic.slug;
    const target = inRun ?? dups.filedUnder(of)[0];
    if (target) dupTarget.set(id, target);
  }

  const plans = new Map<string, NotePlan>();
  const placed = new Map<string, Set<PointId>>();
  const planFor = (slug: string, title: string, isNew: boolean): { plan: NotePlan; seen: Set<PointId> } => {
    let plan = plans.get(slug);
    if (!plan) {
      plan = { slug, title, isNew, blocks: [] };
      plans.set(slug, plan);
      placed.set(slug, new Set(alreadyIn(slug)));
    }
    return { plan, seen: placed.get(slug) ?? new Set<PointId>() };
  };
  const pushRepeatsOf = (of: PointId, slug: string, plan: NotePlan, seen: Set<PointId>): void => {
    for (const [id, target] of dupTarget) {
      if (target !== slug || dupOf.get(id) !== of || seen.has(id)) continue;
      seen.add(id);
      plan.blocks.push({ kind: 'point', id }, duplicateBlock(id, of, meta));
    }
  };

  for (const a of assignments) {
    const ids = a.pointIds.filter((id) => !dupTarget.has(id));
    if (ids.length === 0) continue;
    const { plan, seen } = planFor(a.subtopic.slug, a.subtopic.title, a.subtopic.isNew);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      plan.blocks.push({ kind: 'point', id });
      // A correction sits directly under the point it is about, in every note that files it.
      const c = correctionFor.get(id);
      if (c) plan.blocks.push(correctionBlock(c, meta));
      pushRepeatsOf(id, a.subtopic.slug, plan, seen);
    }
    const body = renderLlmBody({ ...a, pointIds: ids });
    if (body) {
      plan.blocks.push({
        kind: 'llm',
        id: meta.newBlockId(),
        model: meta.model,
        at: meta.at,
        body,
        sources: extractSources(body),
      });
    }
  }
  // Repeats of points filed in an earlier run go at the end of that note.
  for (const [id, slug] of dupTarget) {
    const of = dupOf.get(id);
    if (!of) continue;
    const { plan, seen } = planFor(slug, plans.get(slug)?.title ?? dups.titleOf(slug), false);
    if (seen.has(id)) continue;
    seen.add(id);
    plan.blocks.push({ kind: 'point', id }, duplicateBlock(id, of, meta));
  }
  return [...plans.values()].filter((p) => p.blocks.length > 0);
}

/**
 * Regenerate (HLD §6.4): drops the note's AI blocks and lays out new ones. Point markers,
 * duplicate markers and non-Lode text keep their order and position; each correction sits
 * under its point and each explanation after the last point it covers.
 */
export function layoutRegenerated(
  existing: readonly Block[],
  assignments: readonly ValidAssignment[],
  corrections: readonly ValidCorrection[],
  meta: BlockMeta,
): Block[] {
  const kept = existing.filter((b) => b.kind !== 'llm' || b.duplicate);
  const firstIndex = new Map<PointId, number>();
  kept.forEach((b, i) => {
    if (b.kind === 'point' && !firstIndex.has(b.id)) firstIndex.set(b.id, i);
  });
  const after = new Map<PointId, Block[]>();
  const attach = (id: PointId, block: Block): void => {
    const list = after.get(id);
    if (list) list.push(block);
    else after.set(id, [block]);
  };
  for (const c of corrections) if (firstIndex.has(c.pointId)) attach(c.pointId, correctionBlock(c, meta));
  const trailing: Block[] = [];
  for (const a of assignments) {
    const body = renderLlmBody(a);
    if (!body) continue;
    const block: Block = { kind: 'llm', id: meta.newBlockId(), model: meta.model, at: meta.at, body, sources: extractSources(body) };
    const last = a.pointIds
      .filter((id) => firstIndex.has(id))
      .sort((x, y) => (firstIndex.get(y) ?? 0) - (firstIndex.get(x) ?? 0))[0];
    if (last) attach(last, block);
    else trailing.push(block);
  }
  const out: Block[] = [];
  kept.forEach((b, i) => {
    out.push(b);
    if (b.kind === 'point' && firstIndex.get(b.id) === i) out.push(...(after.get(b.id) ?? []));
  });
  return [...out, ...trailing];
}
