import type { Block, PointId } from '@shared/types';
import { extractSources } from '../formats/note';
import type { ValidAssignment, ValidCorrection } from './validate';

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

/**
 * Groups assignments by subtopic and lays out blocks to append: the point markers,
 * then the AI block that explains them (HLD §6.3 step 2).
 */
export function planNotes(
  assignments: readonly ValidAssignment[],
  alreadyIn: (slug: string) => ReadonlySet<PointId>,
  meta: BlockMeta,
  corrections: readonly ValidCorrection[] = [],
): NotePlan[] {
  const correctionFor = new Map(corrections.map((c) => [c.pointId, c]));
  const plans = new Map<string, NotePlan>();
  const placed = new Map<string, Set<PointId>>();
  for (const a of assignments) {
    let plan = plans.get(a.subtopic.slug);
    if (!plan) {
      plan = { slug: a.subtopic.slug, title: a.subtopic.title, isNew: a.subtopic.isNew, blocks: [] };
      plans.set(a.subtopic.slug, plan);
      placed.set(a.subtopic.slug, new Set(alreadyIn(a.subtopic.slug)));
    }
    const seen = placed.get(a.subtopic.slug) ?? new Set<PointId>();
    for (const id of a.pointIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      plan.blocks.push({ kind: 'point', id });
      // A correction sits directly under the point it is about, in every note that files it.
      const c = correctionFor.get(id);
      if (c) {
        const body = renderCorrectionBody(c);
        plan.blocks.push({
          kind: 'llm',
          id: meta.newBlockId(),
          model: meta.model,
          at: meta.at,
          body,
          sources: extractSources(body),
          correctionFor: id,
        });
      }
    }
    const body = renderLlmBody(a);
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
  return [...plans.values()].filter((p) => p.blocks.length > 0);
}
