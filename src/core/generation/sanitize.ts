/**
 * Model text is untrusted (invariant 3). Lode markers are only recognised as whole
 * lines, so neutralising them here makes it impossible for model text to open or
 * close a block or to forge a point reference.
 */
export function sanitizeLlmText(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      // Point markers anywhere, including partial or spaced variants.
      .replace(/\{\{\s*point\s*:/gi, '')
      // Block fences: any line whose first non-space characters are `::` (e.g. `::`, `::llm{...}`).
      .replace(/^([ \t]*)::/gm, '$1\\:\\:')
      // Raw HTML is left alone (it is never rendered as HTML) so code like `Vec<String>` survives.
      // Control characters other than newline and tab.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** For single-line contexts such as list items and link titles. */
export function sanitizeInline(input: string): string {
  return sanitizeLlmText(input).replace(/\s*\n\s*/g, ' ').trim();
}

export function sanitizeLinkTitle(input: string, fallback: string): string {
  const t = sanitizeInline(input).replace(/[[\]()`*_]/g, '').trim().slice(0, 80);
  return t || fallback;
}
