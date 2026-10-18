import { describe, expect, it } from 'vitest';
import { systemPrompt, userPrompt } from '@core/generation/prompt';

describe('system prompt', () => {
  const p = systemPrompt({ useSearch: true, maxSearches: 4 });

  it('asks for a per-point review and corrections before assignments', () => {
    expect(p.indexOf('"review"')).toBeGreaterThan(-1);
    expect(p.indexOf('"review"')).toBeLessThan(p.indexOf('"corrections":['));
    expect(p.indexOf('"corrections":[')).toBeLessThan(p.indexOf('"assignments":['));
    expect(p).toMatch(/contradicts a point/);
  });

  it('keeps the user-text and marker rules', () => {
    expect(p).toMatch(/Never quote, copy, rewrite or paraphrase/);
    expect(p).toMatch(/Never output the strings "\{\{point:"/);
    expect(p).toMatch(/Never invent URLs/);
  });
});

describe('prompt modes', () => {
  const pts = [{ id: 'p-aaaaaaaa' as const, date: '2026-10-17', text: 'a' }];
  const data = (s: string): Record<string, unknown> =>
    JSON.parse(s.slice(s.indexOf('<data>') + 6, s.indexOf('</data>'))) as Record<string, unknown>;

  it('file mode sends known points for duplicate detection and asks for duplicates', () => {
    const u = data(
      userPrompt({
        folderTitle: 'K',
        points: pts,
        subtopics: [{ slug: 's', title: 'S' }],
        knownPoints: [{ id: 'p-bbbbbbbb', date: '2026-10-01', text: 'b' }],
      }),
    );
    expect(u.knownPoints).toEqual([{ id: 'p-bbbbbbbb', date: '2026-10-01', text: 'b' }]);
    expect(systemPrompt({ useSearch: false, maxSearches: 0 })).toContain('"duplicates"');
  });

  it('regenerate mode pins the subtopic and omits other subtopics', () => {
    const u = data(userPrompt({ folderTitle: 'K', points: pts, subtopics: [], regenerate: { slug: 's', title: 'S' } }));
    expect(u.regenerate).toEqual({ slug: 's', title: 'S' });
    expect(u.existingSubtopics).toBeUndefined();
    expect(u.knownPoints).toBeUndefined();
    const sys = systemPrompt({ useSearch: false, maxSearches: 0, regenerate: true });
    expect(sys).toContain('Use exactly that slug and title');
    expect(sys).not.toContain('4. DUPLICATES');
  });
});
