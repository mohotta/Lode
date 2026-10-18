import type { Block, PointId, Source } from '@shared/types';
import { isPointId } from './ids';
import { renderFrontmatter, splitFrontmatter } from './frontmatter';

/**
 * Note file (HLD §5.3). The body is a sequence of blocks separated by blank lines:
 *
 *   {{point:p-k3x9a2bq}}                      <- transclusion marker, no user text
 *
 *   ::llm{id=b-01 model="x/y" at="2026-..."}  <- generated content
 *   markdown...
 *   ::
 *
 * Markers are only recognised as whole lines, which is why `sanitizeLlmText`
 * neutralises line-leading `::` and removes `{{point:` from model output.
 */

export interface NoteMeta {
  folder: string;
  subtopic: string;
  title: string;
  updated: string;
}

export interface NoteFile {
  meta: NoteMeta;
  blocks: Block[];
}

const POINT_LINE_RE = /^\{\{point:(p-[0-9a-z]{8})\}\}$/;
const LLM_OPEN_RE = /^::llm\{(.*)\}$/;
const LLM_CLOSE = '::';
const ATTR_RE = /([a-zA-Z][\w-]*)=(?:"([^"]*)"|([^\s"}]+))/g;
const BARE_ATTRS = new Set(['id', 'kind', 'for', 'of']);
const LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    if (m[1]) out[m[1]] = m[2] ?? m[3] ?? '';
  }
  return out;
}

function attrValue(v: string): string {
  return v.replace(/["}\n\r]/g, '');
}

export function renderAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (/^[\w.:/-]+$/.test(v) && BARE_ATTRS.has(k) ? `${k}=${v}` : `${k}="${attrValue(v)}"`))
    .join(' ');
}

export function extractSources(markdown: string): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const m of markdown.matchAll(LINK_RE)) {
    const url = m[2];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: m[1] || url, url });
  }
  return out;
}

export function parseNoteBody(body: string): Block[] {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let raw: string[] = [];
  const flushRaw = (): void => {
    const text = raw.join('\n').replace(/^\n+|\n+$/g, '');
    if (text.trim()) blocks.push({ kind: 'raw', text });
    raw = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const point = POINT_LINE_RE.exec(line);
    if (point?.[1] && isPointId(point[1])) {
      flushRaw();
      blocks.push({ kind: 'point', id: point[1] });
      continue;
    }
    const open = LLM_OPEN_RE.exec(line);
    if (open) {
      const close = lines.indexOf(LLM_CLOSE, i + 1);
      if (close !== -1) {
        flushRaw();
        const attrs = parseAttrs(open[1] ?? '');
        const content = lines.slice(i + 1, close).join('\n');
        const forId = attrs.for;
        const ofId = attrs.of;
        blocks.push({
          kind: 'llm',
          id: attrs.id ?? '',
          model: attrs.model ?? '',
          at: attrs.at ?? '',
          body: content,
          sources: extractSources(content),
          ...(attrs.kind === 'correction' && forId && isPointId(forId) ? { correctionFor: forId } : {}),
          ...(attrs.kind === 'duplicate' && forId && isPointId(forId) && ofId && isPointId(ofId)
            ? { duplicate: { id: forId, of: ofId } }
            : {}),
        });
        i = close;
        continue;
      }
    }
    if (line === '' && raw.length === 0) continue;
    if (line === '') {
      flushRaw();
      continue;
    }
    raw.push(line);
  }
  flushRaw();
  return blocks;
}

export function serialiseBlock(block: Block): string {
  switch (block.kind) {
    case 'point':
      return `{{point:${block.id}}}`;
    case 'llm': {
      const attrs: Record<string, string> = { id: block.id };
      if (block.correctionFor) Object.assign(attrs, { kind: 'correction', for: block.correctionFor });
      else if (block.duplicate) Object.assign(attrs, { kind: 'duplicate', for: block.duplicate.id, of: block.duplicate.of });
      Object.assign(attrs, { model: block.model, at: block.at });
      return `::llm{${renderAttrs(attrs)}}\n${block.body}\n${LLM_CLOSE}`;
    }
    case 'raw':
      return block.text;
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function parseNote(content: string, fallback: { folder: string; subtopic: string }): NoteFile {
  const { data, body } = splitFrontmatter(content);
  return {
    meta: {
      folder: str(data.folder, fallback.folder),
      subtopic: str(data.subtopic, fallback.subtopic),
      title: str(data.title, fallback.subtopic),
      updated: str(data.updated),
    },
    blocks: parseNoteBody(body),
  };
}

export function renderNoteFrontmatter(meta: NoteMeta): string {
  return renderFrontmatter({ folder: meta.folder, subtopic: meta.subtopic, title: meta.title, updated: meta.updated });
}

export function serialiseNote(note: NoteFile): string {
  const body = note.blocks.map(serialiseBlock).join('\n\n');
  return `${renderNoteFrontmatter(note.meta)}\n${body}${body ? '\n' : ''}`;
}

/**
 * Appends blocks to an existing note without changing any existing block (invariant 5).
 * Only the frontmatter `updated` field is refreshed.
 */
export function appendBlocks(existing: string | null, meta: NoteMeta, blocks: readonly Block[]): string {
  const added = blocks.map(serialiseBlock).join('\n\n');
  if (existing === null) return `${renderNoteFrontmatter(meta)}\n${added}\n`;
  const split = splitFrontmatter(existing);
  const head = split.hasFrontmatter
    ? renderNoteFrontmatter({
        folder: str(split.data.folder, meta.folder),
        subtopic: str(split.data.subtopic, meta.subtopic),
        title: str(split.data.title, meta.title),
        updated: meta.updated,
      })
    : renderNoteFrontmatter(meta);
  const rest = (split.hasFrontmatter ? split.body : existing).replace(/\n*$/, '');
  if (!rest.trim()) return `${head}\n${added}\n`;
  return `${head}${rest.startsWith('\n') ? rest : `\n${rest}`}\n\n${added}\n`;
}

export function pointIdsIn(blocks: readonly Block[]): PointId[] {
  return blocks.flatMap((b) => (b.kind === 'point' ? [b.id] : []));
}

/** Point IDs that have an AI correction note in these blocks. */
export function correctedIdsIn(blocks: readonly Block[]): PointId[] {
  return blocks.flatMap((b) => (b.kind === 'llm' && b.correctionFor ? [b.correctionFor] : []));
}

/** Duplicate point ID -> the earlier point it repeats, from `kind=duplicate` blocks. */
export function duplicatesIn(blocks: readonly Block[]): Map<PointId, PointId> {
  const out = new Map<PointId, PointId>();
  for (const b of blocks) if (b.kind === 'llm' && b.duplicate) out.set(b.duplicate.id, b.duplicate.of);
  return out;
}

/** Replaces only the frontmatter title; the body (every block) is kept byte for byte. */
export function retitleNote(existing: string, meta: NoteMeta): string {
  const split = splitFrontmatter(existing);
  const body = split.hasFrontmatter ? split.body : `\n${existing}`;
  return renderNoteFrontmatter(meta) + body;
}
