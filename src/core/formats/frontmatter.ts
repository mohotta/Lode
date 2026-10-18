import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface Split {
  data: Record<string, unknown>;
  /** Raw frontmatter text between the fences, without the fences. '' if none. */
  raw: string;
  body: string;
  hasFrontmatter: boolean;
}

const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(content: string): Split {
  const m = FENCE_RE.exec(content);
  if (!m) return { data: {}, raw: '', body: content, hasFrontmatter: false };
  const raw = m[1] ?? '';
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // Malformed frontmatter from an external edit: treat as empty rather than failing the whole file.
  }
  return { data, raw, body: content.slice(m[0].length), hasFrontmatter: true };
}

export function renderFrontmatter(data: Record<string, unknown>): string {
  return `---\n${stringifyYaml(data, { lineWidth: 0, flowCollectionPadding: false }).trimEnd()}\n---\n`;
}
