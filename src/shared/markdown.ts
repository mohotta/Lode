const fenceRe = /^\s*(```|~~~)/;

/**
 * The rich editor writes a hard break as "two spaces + newline"; the backlog keeps plain newlines
 * (rendered as breaks), so strip that outside code fences and trim the ends.
 */
export function tidyMarkdown(md: string): string {
  let inFence = false;
  return md
    .split('\n')
    .map((line) => {
      if (fenceRe.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(/ {2,}$/, '');
    })
    .join('\n')
    .trim();
}
