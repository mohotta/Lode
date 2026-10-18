import { describe, expect, it } from 'vitest';
import { systemPrompt } from '@core/generation/prompt';

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
