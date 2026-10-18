import { describe, expect, it } from 'vitest';
import { parseBacklog, replaceEntryText, setTombstone } from '@core/formats/backlog';
import { duplicatesIn, parseNote, serialiseNote, type NoteFile } from '@core/formats/note';
import { findDuplicate, normaliseForCompare } from '@core/repos/duplicates';
import type { Point } from '@shared/types';

const DAY = `---
date: 2026-10-17
deleted: []
---
- first point ^p-aaaaaaaa
- multi line
  second line ^p-bbbbbbbb
- third ^p-cccccccc
`;

describe('backlog edit and soft delete (format)', () => {
  it('replaces only the edited entry; every other byte stays', () => {
    const out = replaceEntryText(DAY, 'p-bbbbbbbb', 'now one line');
    expect(out).toBe(DAY.replace('- multi line\n  second line ^p-bbbbbbbb', '- now one line ^p-bbbbbbbb'));
    const back = replaceEntryText(out, 'p-bbbbbbbb', 'multi line\nsecond line');
    expect(back).toBe(DAY);
    expect(parseBacklog(out, '2026-10-17').entries.map((e) => e.id)).toEqual(['p-aaaaaaaa', 'p-bbbbbbbb', 'p-cccccccc']);
  });

  it('can turn a one-line point into several lines and keeps the ID on the last line', () => {
    const out = replaceEntryText(DAY, 'p-cccccccc', 'third\n```js\nx()\n```');
    expect(parseBacklog(out, '2026-10-17').entries[2]).toEqual({ id: 'p-cccccccc', text: 'third\n```js\nx()\n```' });
    expect(out.startsWith(DAY.slice(0, DAY.indexOf('- third')))).toBe(true);
  });

  it('refuses an unknown ID', () => {
    expect(() => replaceEntryText(DAY, 'p-zzzzzzzz', 'x')).toThrow(/not found/);
  });

  it('tombstones and restores without touching the body', () => {
    const del = setTombstone(DAY, '2026-10-17', 'p-aaaaaaaa', true);
    expect(parseBacklog(del, 'x').deleted).toEqual(['p-aaaaaaaa']);
    expect(del.endsWith(DAY.slice(DAY.indexOf('- first')))).toBe(true);
    expect(setTombstone(del, '2026-10-17', 'p-aaaaaaaa', true)).toBe(del); // idempotent
    expect(setTombstone(del, '2026-10-17', 'p-aaaaaaaa', false)).toBe(DAY);
  });
});

describe('duplicate note blocks (format)', () => {
  it('round-trips a duplicate block and reads it back', () => {
    const note: NoteFile = {
      meta: { folder: 'k', subtopic: 's', title: 'S', updated: '2026-10-17T10:42:00.000Z' },
      blocks: [
        { kind: 'point', id: 'p-aaaaaaaa' },
        { kind: 'point', id: 'p-bbbbbbbb' },
        {
          kind: 'llm',
          id: 'b-00000001',
          model: 'm/x',
          at: '2026-10-17T10:42:00.000Z',
          body: 'Repeats an earlier point.',
          sources: [],
          duplicate: { id: 'p-bbbbbbbb', of: 'p-aaaaaaaa' },
        },
      ],
    };
    const raw = serialiseNote(note);
    expect(raw).toContain('::llm{id=b-00000001 kind=duplicate for=p-bbbbbbbb of=p-aaaaaaaa model="m/x"');
    const back = parseNote(raw, { folder: 'k', subtopic: 's' });
    expect(back).toEqual(note);
    expect(serialiseNote(back)).toBe(raw);
    expect([...duplicatesIn(back.blocks)]).toEqual([['p-bbbbbbbb', 'p-aaaaaaaa']]);
  });
});

const pt = (id: string, text: string, deleted = false): Point => ({
  id: id as Point['id'],
  text,
  date: '2026-10-10',
  folder: 'k',
  deleted,
});

describe('local duplicate detection', () => {
  const points = [
    pt('p-aaaaaaaa', 'ClusterIP services are only reachable **inside** the cluster.'),
    pt('p-bbbbbbbb', 'Use `git rebase -i` to squash commits'),
    pt('p-cccccccc', 'kube-proxy IPVS mode scales better than iptables', true),
  ];

  it('normalises case, punctuation and markdown', () => {
    expect(normaliseForCompare('**Hello**, `World`!')).toBe('hello world');
  });

  it('flags the same words as exact, regardless of case, markdown and order', () => {
    expect(findDuplicate('clusterip services are only reachable inside the cluster', points)).toMatchObject({
      exact: true,
      point: { id: 'p-aaaaaaaa' },
    });
    expect(findDuplicate('to squash commits use git rebase -i', points)).toMatchObject({ exact: true });
  });

  it('flags near repeats but not merely related points', () => {
    const near = findDuplicate('ClusterIP services are reachable only inside the cluster network', points);
    expect(near).toMatchObject({ exact: false, point: { id: 'p-aaaaaaaa' } });
    expect(findDuplicate('NodePort services are reachable from outside the cluster', points)).toBeNull();
    expect(findDuplicate('use git merge', points)).toBeNull();
  });

  it('ignores deleted points', () => {
    expect(findDuplicate('kube-proxy IPVS mode scales better than iptables', points)).toBeNull();
  });
});
