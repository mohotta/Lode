/** Canonical form used to check that a cited URL appeared in this run's search results. */
export function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.replace(/^http:/, 'https:');
  } catch {
    return null;
  }
}

export class AllowedUrls {
  private readonly map = new Map<string, { url: string; title: string }>();

  add(url: string, title: string): void {
    const n = normaliseUrl(url);
    if (n && !this.map.has(n)) this.map.set(n, { url, title });
  }

  /** Returns the URL exactly as the search provider reported it, or null if it was never seen. */
  lookup(url: string): { url: string; title: string } | null {
    const n = normaliseUrl(url);
    return (n && this.map.get(n)) || null;
  }

  get size(): number {
    return this.map.size;
  }
}

/** Makes a URL safe to place inside a markdown link target. */
export function markdownHref(url: string): string {
  return url.replace(/[()\s<>]/g, (c) => encodeURIComponent(c).replace(/[()]/g, (p) => (p === '(' ? '%28' : '%29')));
}
