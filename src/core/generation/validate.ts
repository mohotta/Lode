import type { PointId } from '@shared/types';
import { slugify } from '../formats/slug';
import type { SearchResult } from '../llm/types';
import {
  ArticleCheckSchema,
  ArticleOutputSchema,
  DigestOutputSchema,
  GenerationOutputSchema,
  type ArticleCheck,
  type ArticleOutput,
  type DigestOutput,
  type GenerationOutput,
} from './schema';
import { sanitizeInline, sanitizeLinkTitle, sanitizeLlmText } from './sanitize';
import { AllowedUrls, markdownHref } from './urls';

export type UnsourcedPolicy = 'drop' | 'mark';

export interface ValidAddition {
  text: string;
  sources: { title: string; url: string }[];
  unsourced: boolean;
}

export interface ValidAssignment {
  pointIds: PointId[];
  subtopic: { slug: string; title: string; isNew: boolean };
  explanation: string;
  additions: ValidAddition[];
}

export interface ValidCorrection {
  pointId: PointId;
  issue: string;
  correction: string;
  sources: { title: string; url: string }[];
  unsourced: boolean;
}

export interface ValidDuplicate {
  pointId: PointId;
  /** The earliest point it repeats: from this run (sent earlier) or an already-filed known point. */
  duplicateOf: PointId;
}

export interface ValidationReport {
  assignments: ValidAssignment[];
  corrections: ValidCorrection[];
  duplicates: ValidDuplicate[];
  /** Points sent but not validly assigned. */
  leftovers: PointId[];
  warnings: string[];
  stats: { inventedIds: number; droppedAdditions: number; unsourcedAdditions: number; strippedLinks: number };
}

export interface ValidateContext {
  /** Oldest first; a repeat can only point at an earlier one. */
  sentIds: readonly PointId[];
  /** Already-filed points shown to the model for duplicate detection. */
  knownIds?: readonly PointId[];
  existingSubtopics: readonly { slug: string; title: string }[];
  searchResults: readonly SearchResult[];
  unsourced: UnsourcedPolicy;
}

export type ParseResult = { ok: true; output: GenerationOutput } | { ok: false; error: string };

export function parseOutput(json: unknown): ParseResult {
  const r = GenerationOutputSchema.safeParse(json);
  if (r.success) return { ok: true, output: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'invalid output' };
}

const MD_LINK_RE = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BARE_URL_RE = /<?\bhttps?:\/\/[^\s<>)\]]+>?/g;

/** Keeps markdown links whose URL was in the search results; turns the rest into plain text. */
function filterLinks(text: string, allowed: AllowedUrls, onStrip: () => void): string {
  const kept: string[] = [];
  const withPlaceholders = text.replace(MD_LINK_RE, (_m, label: string, url: string) => {
    const hit = allowed.lookup(url);
    if (!hit) {
      onStrip();
      return label;
    }
    kept.push(`[${sanitizeLinkTitle(label, 'source')}](${markdownHref(hit.url)})`);
    return `\u0000${kept.length - 1}\u0000`;
  });
  const noBare = withPlaceholders.replace(BARE_URL_RE, (m) => {
    const url = m.replace(/^<|>$/g, '');
    const hit = allowed.lookup(url);
    if (!hit) {
      onStrip();
      return '';
    }
    kept.push(`[${sanitizeLinkTitle(hit.title, 'source')}](${markdownHref(hit.url)})`);
    return `\u0000${kept.length - 1}\u0000`;
  });
  // eslint-disable-next-line no-control-regex
  return noBare.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? '');
}

/** Applies HLD §6.2. Never throws on bad content: bad items are dropped and reported. */
export function validateOutput(output: GenerationOutput, ctx: ValidateContext): ValidationReport {
  const sent = new Set<string>(ctx.sentIds);
  const allowed = new AllowedUrls();
  for (const r of ctx.searchResults) allowed.add(r.url, r.title);
  const existing = new Map(ctx.existingSubtopics.map((s) => [s.slug, s.title]));
  const stats = { inventedIds: 0, droppedAdditions: 0, unsourcedAdditions: 0, strippedLinks: 0 };
  const warnings: string[] = [];
  const assigned = new Set<PointId>();
  const out: ValidAssignment[] = [];

  for (const a of output.assignments) {
    const ids: PointId[] = [];
    for (const raw of a.pointIds) {
      if (!sent.has(raw)) {
        stats.inventedIds++;
        continue;
      }
      if (!ids.includes(raw as PointId)) ids.push(raw as PointId);
    }
    if (ids.length === 0) {
      warnings.push('Ignored an assignment that referenced no point from this run.');
      continue;
    }

    const title = sanitizeInline(a.subtopic.title).slice(0, 80);
    const slug = slugify(a.subtopic.slug) || slugify(title);
    if (!slug || !title) {
      warnings.push('Ignored an assignment with an unusable subtopic name.');
      continue;
    }
    const existingTitle = existing.get(slug);

    const explanation = filterLinks(sanitizeLlmText(a.explanation), allowed, () => stats.strippedLinks++);

    const additions: ValidAddition[] = [];
    for (const add of a.additions) {
      const text = filterLinks(sanitizeInline(add.text), allowed, () => stats.strippedLinks++).replace(
        MD_LINK_RE,
        '$1',
      );
      if (!text) continue;
      const sources: { title: string; url: string }[] = [];
      for (const s of add.sources) {
        const hit = allowed.lookup(s.url);
        if (hit && !sources.some((x) => x.url === hit.url)) {
          sources.push({ title: sanitizeLinkTitle(s.title || hit.title, 'source'), url: markdownHref(hit.url) });
        }
      }
      if (sources.length === 0) {
        if (ctx.unsourced === 'drop') {
          stats.droppedAdditions++;
          continue;
        }
        stats.unsourcedAdditions++;
        additions.push({ text, sources, unsourced: true });
      } else {
        additions.push({ text, sources, unsourced: false });
      }
    }

    for (const id of ids) assigned.add(id);
    out.push({
      pointIds: ids,
      subtopic: { slug, title: existingTitle ?? title, isNew: existingTitle === undefined },
      explanation,
      additions,
    });
  }

  // Corrections: same rules as additions (known point, sanitised text, verifiable source).
  const corrections: ValidCorrection[] = [];
  let droppedCorrections = 0;
  for (const c of output.corrections) {
    if (!sent.has(c.pointId)) {
      stats.inventedIds++;
      continue;
    }
    const strip = (t: string): string =>
      filterLinks(sanitizeInline(t), allowed, () => stats.strippedLinks++).replace(MD_LINK_RE, '$1');
    const issue = strip(c.issue);
    const correction = strip(c.correction);
    if (!issue || !correction) continue;
    const sources: { title: string; url: string }[] = [];
    for (const s of c.sources) {
      const hit = allowed.lookup(s.url);
      if (hit && !sources.some((x) => x.url === markdownHref(hit.url))) {
        sources.push({ title: sanitizeLinkTitle(s.title || hit.title, 'source'), url: markdownHref(hit.url) });
      }
    }
    if (sources.length === 0 && ctx.unsourced === 'drop') {
      droppedCorrections++;
      continue;
    }
    if (corrections.some((x) => x.pointId === c.pointId)) continue; // one correction per point
    corrections.push({ pointId: c.pointId as PointId, issue, correction, sources, unsourced: sources.length === 0 });
  }
  if (droppedCorrections) warnings.push(`Dropped ${droppedCorrections} correction(s) without a verifiable source.`);

  // Points the model itself judged wrong but left without a usable correction: say so instead of staying silent.
  const corrected = new Set(corrections.map((c) => c.pointId));
  const flaggedNoFix = new Set(
    output.review
      .filter((r) => r.verdict !== 'accurate' && sent.has(r.pointId) && !corrected.has(r.pointId as PointId))
      .map((r) => r.pointId),
  );
  if (flaggedNoFix.size) {
    warnings.push(
      `The model judged ${flaggedNoFix.size} point(s) partly or fully inaccurate but gave no correction with a verifiable source` +
        (ctx.unsourced === 'drop' ? ' (Settings drops unsourced corrections).' : '.'),
    );
  }

  // Duplicates: IDs only; a repeat must point at a known point or one sent before it (no cycles).
  const order = new Map(ctx.sentIds.map((id, i) => [id as string, i]));
  const known = new Set<string>(ctx.knownIds ?? []);
  const dupOf = new Map<PointId, PointId>();
  const dups = [...output.duplicates].sort((a, b) => (order.get(a.pointId) ?? 0) - (order.get(b.pointId) ?? 0));
  for (const d of dups) {
    const i = order.get(d.pointId);
    if (i === undefined || dupOf.has(d.pointId as PointId)) continue;
    const j = order.get(d.duplicateOf);
    if (!(known.has(d.duplicateOf) || (j !== undefined && j < i))) continue;
    const root = dupOf.get(d.duplicateOf as PointId) ?? (d.duplicateOf as PointId);
    dupOf.set(d.pointId as PointId, root);
  }
  const duplicates = [...dupOf].map(([pointId, duplicateOf]) => ({ pointId, duplicateOf }));

  if (stats.inventedIds) warnings.push(`Ignored ${stats.inventedIds} point ID(s) the model invented.`);
  if (stats.droppedAdditions) warnings.push(`Dropped ${stats.droppedAdditions} addition(s) without a verifiable source.`);
  if (stats.strippedLinks) warnings.push(`Removed ${stats.strippedLinks} link(s) that were not in the search results.`);

  return { assignments: out, corrections, duplicates, leftovers: ctx.sentIds.filter((id) => !assigned.has(id)), warnings, stats };
}

export type DigestParseResult = { ok: true; output: DigestOutput } | { ok: false; error: string };

export function parseDigestOutput(json: unknown): DigestParseResult {
  const r = DigestOutputSchema.safeParse(json);
  if (r.success) return { ok: true, output: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'invalid output' };
}

export interface ValidDigest {
  summary: string;
  themes: { title: string; pointIds: PointId[]; summary: string }[];
  /** Points sent but not placed in any theme. */
  leftovers: PointId[];
  warnings: string[];
}

/**
 * Digests have no web search, so no link can be verified: every link is reduced to its
 * label and bare URLs are removed. Each point may appear in one theme only.
 */
export function validateDigest(output: DigestOutput, sentIds: readonly PointId[]): ValidDigest {
  const sent = new Set<string>(sentIds);
  const none = new AllowedUrls();
  let stripped = 0;
  let invented = 0;
  const clean = (t: string): string => filterLinks(sanitizeLlmText(t), none, () => stripped++);
  const used = new Set<PointId>();
  const themes: ValidDigest['themes'] = [];
  for (const t of output.themes) {
    const ids: PointId[] = [];
    for (const raw of t.pointIds) {
      if (!sent.has(raw)) {
        invented++;
        continue;
      }
      if (used.has(raw as PointId)) continue;
      used.add(raw as PointId);
      ids.push(raw as PointId);
    }
    const title = sanitizeInline(t.title).slice(0, 80);
    const summary = clean(t.summary);
    if (!title || (ids.length === 0 && !summary)) continue;
    themes.push({ title, pointIds: ids, summary });
  }
  const warnings: string[] = [];
  if (invented) warnings.push(`Ignored ${invented} point ID(s) the model invented.`);
  if (stripped) warnings.push(`Removed ${stripped} link(s); digests are not web-sourced.`);
  return { summary: clean(output.summary), themes, leftovers: sentIds.filter((id) => !used.has(id)), warnings };
}

export type ArticleParseResult = { ok: true; output: ArticleOutput } | { ok: false; error: string };
export type CheckParseResult = { ok: true; output: ArticleCheck } | { ok: false; error: string };

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  return first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'invalid output';
}

const NOT_JSON = 'the reply was not a single valid JSON object (it may have been cut off)';

export function parseArticleOutput(json: unknown): ArticleParseResult {
  if (json === undefined) return { ok: false, error: NOT_JSON };
  const r = ArticleOutputSchema.safeParse(json);
  return r.success ? { ok: true, output: r.data } : { ok: false, error: firstIssue(r.error.issues) };
}

export function parseArticleCheck(json: unknown): CheckParseResult {
  if (json === undefined) return { ok: false, error: NOT_JSON };
  const r = ArticleCheckSchema.safeParse(json);
  return r.success ? { ok: true, output: r.data } : { ok: false, error: firstIssue(r.error.issues) };
}

export interface ValidSection {
  heading: string;
  body: string;
  pointIds: PointId[];
  /** No point and no verified link backs this section (invariant 6: flagged, not dropped). */
  unsourced: boolean;
}

export interface ValidArticle {
  sections: ValidSection[];
  warnings: string[];
}

/**
 * Notes (articles): links must be to a URL from this job's search results or one already in
 * the material or the note; others become their label. Each point may appear once.
 */
export function validateArticle(output: ArticleOutput, ctx: { sentIds: readonly PointId[]; allowed: AllowedUrls }): ValidArticle {
  const sent = new Set<string>(ctx.sentIds);
  let stripped = 0;
  let invented = 0;
  const used = new Set<PointId>();
  const sections: ValidSection[] = [];
  for (const sec of output.sections) {
    const ids: PointId[] = [];
    for (const raw of sec.pointIds) {
      if (!sent.has(raw)) {
        invented++;
        continue;
      }
      if (used.has(raw as PointId)) continue;
      used.add(raw as PointId);
      ids.push(raw as PointId);
    }
    const heading = sanitizeInline(sec.heading).replace(/^#+\s*/, '').slice(0, 80);
    const body = filterLinks(sanitizeLlmText(sec.body), ctx.allowed, () => stripped++);
    if (!heading || (!body && ids.length === 0)) continue;
    const cited = /\[[^\]\n]*\]\(https?:/.test(body);
    sections.push({ heading, body, pointIds: ids, unsourced: ids.length === 0 && !cited });
  }
  const warnings: string[] = [];
  if (invented) warnings.push(`Ignored ${invented} point ID(s) the model invented.`);
  if (stripped) warnings.push(`Removed ${stripped} link(s) that were not in the search results or the material.`);
  const unsourced = sections.filter((x) => x.unsourced).length;
  if (unsourced) warnings.push(`${unsourced} section(s) have no cited source and are marked.`);
  return { sections, warnings };
}

/** The checker's issues, cleaned for the next prompt. Section numbers outside the draft count as the whole note. */
export function validateCheck(output: ArticleCheck, sections: number): { section: number; problem: string; fix: string }[] {
  return output.issues
    .map((i) => ({
      section: i.section >= 1 && i.section <= sections ? i.section : 0,
      problem: sanitizeInline(i.problem).slice(0, 500),
      fix: sanitizeInline(i.fix).slice(0, 800),
    }))
    .filter((i) => i.problem)
    .slice(0, 20);
}
