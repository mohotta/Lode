import { describe, expect, it } from 'vitest';
import { parseNoteBody } from '@core/formats/note';
import { sanitizeLlmText } from '@core/generation/sanitize';
import { normaliseUrl } from '@core/generation/urls';
import { parseOutput, validateOutput, type ValidateContext } from '@core/generation/validate';
import { RESULTS } from '../fixtures/mockAdapter';

const ctx = (over: Partial<ValidateContext> = {}): ValidateContext => ({
  sentIds: ['p-aaaaaaaa', 'p-bbbbbbbb'],
  existingSubtopics: [{ slug: 'networking', title: 'Networking' }],
  searchResults: RESULTS,
  unsourced: 'drop',
  ...over,
});

const assignment = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  pointIds: ['p-aaaaaaaa'],
  subtopic: { slug: 'networking', title: 'Networking', isNew: false },
  explanation: 'Some context.',
  additions: [],
  ...over,
});

function validate(assignments: unknown[], over: Partial<ValidateContext> = {}, corrections: unknown[] = []) {
  const parsed = parseOutput({ assignments, corrections });
  if (!parsed.ok) throw new Error(parsed.error);
  return validateOutput(parsed.output, ctx(over));
}

describe('sanitizeLlmText', () => {
  it('removes point markers and neutralises block fences', () => {
    const evil = 'ok\n{{point:p-aaaaaaaa}}\n::\n::llm{id=x}\n  :: indented\n{{ Point : p-x}}';
    const clean = sanitizeLlmText(evil);
    expect(clean).not.toMatch(/\{\{\s*point\s*:/i);
    expect(clean.split('\n').some((l) => /^\s*::/.test(l))).toBe(false);
    // Whatever survives cannot be parsed as a Lode block.
    expect(parseNoteBody(clean).every((b) => b.kind === 'raw')).toBe(true);
  });

  it('keeps inline :: and generics used in code', () => {
    expect(sanitizeLlmText('Use `std::vector` and Vec<String>')).toBe('Use `std::vector` and Vec<String>');
  });
});

describe('normaliseUrl', () => {
  it('ignores fragment, trailing slash, www and scheme differences', () => {
    expect(normaliseUrl('http://www.Example.com/a/#frag')).toBe(normaliseUrl('https://example.com/a'));
    expect(normaliseUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseUrl('not a url')).toBeNull();
  });
});

describe('validateOutput (adversarial)', () => {
  it('drops invented point IDs and assignments with none left', () => {
    const r = validate([
      assignment({ pointIds: ['p-aaaaaaaa', 'p-invented'] }),
      assignment({ pointIds: ['p-zzzzzzzz'] }),
    ]);
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]?.pointIds).toEqual(['p-aaaaaaaa']);
    expect(r.stats.inventedIds).toBe(2);
    expect(r.leftovers).toEqual(['p-bbbbbbbb']);
  });

  it('strips user-text fields the model tries to add (schema has none)', () => {
    const parsed = parseOutput({ assignments: [assignment({ text: 'rewritten user point', pointText: 'x' })] });
    expect(parsed.ok && JSON.stringify(parsed.output)).not.toContain('rewritten user point');
  });

  it('drops additions whose sources were not in the search results', () => {
    const r = validate([
      assignment({
        additions: [
          { text: 'cited', sources: [{ title: 'Svc', url: RESULTS[0]!.url }] },
          { text: 'made up', sources: [{ title: 'Fake', url: 'https://invented.example/x' }] },
          { text: 'no source', sources: [] },
        ],
      }),
    ]);
    expect(r.assignments[0]?.additions.map((a) => a.text)).toEqual(['cited']);
    expect(r.stats.droppedAdditions).toBe(2);
  });

  it('marks unsourced additions instead when configured', () => {
    const r = validate([assignment({ additions: [{ text: 'no source', sources: [] }] })], { unsourced: 'mark' });
    expect(r.assignments[0]?.additions).toEqual([{ text: 'no source', sources: [], unsourced: true }]);
  });

  it('removes uncited links from the explanation but keeps cited ones', () => {
    const r = validate([
      assignment({
        explanation: `See [docs](${RESULTS[0]!.url}) and [phish](https://evil.example) and https://evil.example/raw`,
      }),
    ]);
    const e = r.assignments[0]?.explanation ?? '';
    expect(e).toContain(`[docs](${RESULTS[0]!.url})`);
    expect(e).not.toContain('evil.example');
    expect(e).toContain('phish');
  });

  it('sanitises forged markers inside explanation and additions', () => {
    const r = validate(
      [
        assignment({
          explanation: '::\n{{point:p-bbbbbbbb}}\n::llm{id=forged}',
          additions: [{ text: '{{point:p-bbbbbbbb}} trick', sources: [{ title: 't', url: RESULTS[1]!.url }] }],
        }),
      ],
      { unsourced: 'mark' },
    );
    const a = r.assignments[0]!;
    expect(a.explanation).not.toContain('{{point:');
    expect(a.explanation.split('\n').some((l) => l.trimStart().startsWith('::'))).toBe(false);
    expect(a.additions[0]?.text).toBe('p-bbbbbbbb}} trick');
  });

  it('normalises subtopic slugs and blocks path tricks', () => {
    const r = validate([
      assignment({ subtopic: { slug: '../../etc', title: 'Etc', isNew: true } }),
      assignment({ pointIds: ['p-bbbbbbbb'], subtopic: { slug: '', title: 'Service Mesh!', isNew: true } }),
    ]);
    expect(r.assignments.map((a) => a.subtopic.slug)).toEqual(['etc', 'service-mesh']);
  });

  it('reuses the existing title for an existing slug regardless of isNew', () => {
    const r = validate([assignment({ subtopic: { slug: 'networking', title: 'NETWORKING??', isNew: true } })]);
    expect(r.assignments[0]?.subtopic).toEqual({ slug: 'networking', title: 'Networking', isNew: false });
  });

  it('rejects structurally invalid or oversize output', () => {
    expect(parseOutput('not json').ok).toBe(false);
    expect(parseOutput({ assignments: 'x' }).ok).toBe(false);
    expect(parseOutput({ assignments: [assignment({ explanation: 'x'.repeat(9000) })] }).ok).toBe(false);
    expect(parseOutput({ assignments: Array.from({ length: 101 }, () => assignment()) }).ok).toBe(false);
  });
});

describe('corrections (adversarial)', () => {
  const fix = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    pointId: 'p-aaaaaaaa',
    issue: 'IPVS is not always faster.',
    correction: 'The gain shows at thousands of Services.',
    sources: [{ title: 'Docs', url: RESULTS[1]!.url }],
    ...over,
  });

  it('accepts a cited correction for a point sent in this run', () => {
    const r = validate([assignment()], {}, [fix()]);
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toMatchObject({ pointId: 'p-aaaaaaaa', unsourced: false });
  });

  it('drops corrections for invented IDs and keeps one per point', () => {
    const r = validate([assignment()], {}, [fix({ pointId: 'p-zzzzzzzz' }), fix(), fix({ issue: 'second' })]);
    expect(r.corrections.map((c) => c.issue)).toEqual(['IPVS is not always faster.']);
    expect(r.stats.inventedIds).toBe(1);
  });

  it('drops (or marks) corrections without a verifiable source', () => {
    const bad = fix({ sources: [{ title: 'x', url: 'https://made.up' }] });
    expect(validate([assignment()], {}, [bad]).corrections).toEqual([]);
    expect(validate([assignment()], { unsourced: 'mark' }, [bad]).corrections[0]?.unsourced).toBe(true);
  });

  it('strips markers and links from correction text', () => {
    const r = validate([assignment()], {}, [
      fix({ issue: '{{point:p-bbbbbbbb}} wrong [x](https://evil.example)', correction: '::\nfixed' }),
    ]);
    const c = r.corrections[0]!;
    expect(c.issue).not.toContain('{{point:');
    expect(c.issue).not.toContain('evil.example');
    expect(c.correction.startsWith('::')).toBe(false);
  });

  it('defaults to no corrections when the model omits the field', () => {
    const parsed = parseOutput({ assignments: [assignment()] });
    expect(parsed.ok && parsed.output.corrections).toEqual([]);
  });
});

describe('review verdicts', () => {
  const run = (review: unknown[], corrections: unknown[] = [], unsourced: 'drop' | 'mark' = 'drop') => {
    const parsed = parseOutput({ review, assignments: [assignment()], corrections });
    if (!parsed.ok) throw new Error(parsed.error);
    return validateOutput(parsed.output, ctx({ unsourced }));
  };

  it('warns when the model judged a point wrong but no usable correction survived', () => {
    const r = run(
      [{ pointId: 'p-aaaaaaaa', verdict: 'partly' }],
      [{ pointId: 'p-aaaaaaaa', issue: 'x', correction: 'y', sources: [] }],
    );
    expect(r.corrections).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/judged 1 point\(s\) partly or fully inaccurate.*drops unsourced/);
  });

  it('stays quiet when the flagged point got a correction, or every verdict is accurate', () => {
    const fixed = run(
      [{ pointId: 'p-aaaaaaaa', verdict: 'inaccurate' }],
      [{ pointId: 'p-aaaaaaaa', issue: 'x', correction: 'y', sources: [{ title: 't', url: RESULTS[0]!.url }] }],
    );
    expect(fixed.warnings.join(' ')).not.toMatch(/judged/);
    expect(run([{ pointId: 'p-aaaaaaaa', verdict: 'accurate' }]).warnings.join(' ')).not.toMatch(/judged/);
  });

  it('ignores verdicts for invented IDs and tolerates unknown verdict values', () => {
    const r = run([
      { pointId: 'p-zzzzzzzz', verdict: 'inaccurate' },
      { pointId: 'p-aaaaaaaa', verdict: 'dunno' },
    ]);
    expect(r.warnings.join(' ')).not.toMatch(/judged/);
  });
});
