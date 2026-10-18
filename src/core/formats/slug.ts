export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 64;

export function isSlug(value: string): boolean {
  return value.length <= MAX_SLUG && SLUG_RE.test(value);
}

/** Lowercase, `[a-z0-9-]` only. Returns '' when nothing usable remains. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

/** Picks `base`, or `base-2`, `base-3`... so it does not collide with `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || 'untitled';
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root.slice(0, MAX_SLUG - String(i).length - 1)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
