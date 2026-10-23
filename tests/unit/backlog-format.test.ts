import { describe, expect, it } from 'vitest';
import {
  appendEntry,
  isCalendarDate,
  normalisePointText,
  parseBacklog,
  removeEntry,
  serialiseBacklog,
  setTombstone,
  type BacklogFile,
} from '@core/formats/backlog';

const SAMPLE = `---
date: 2026-10-17
deleted: []
---
- ClusterIP services are only reachable inside the cluster ^p-k3x9a2bq
- kube-proxy in IPVS mode scales better than iptables ^p-m1z7c0de
`;

describe('backlog format', () => {
  it('parses the HLD example', () => {
    const f = parseBacklog(SAMPLE, '1999-01-01');
    expect(f.date).toBe('2026-10-17');
    expect(f.deleted).toEqual([]);
    expect(f.entries).toEqual([
      { id: 'p-k3x9a2bq', text: 'ClusterIP services are only reachable inside the cluster' },
      { id: 'p-m1z7c0de', text: 'kube-proxy in IPVS mode scales better than iptables' },
    ]);
  });

  it('round-trips byte for byte', () => {
    expect(serialiseBacklog(parseBacklog(SAMPLE, 'x'))).toBe(SAMPLE);
  });

  it('round-trips multi-line points, tombstones and blank continuation lines', () => {
    const file: BacklogFile = {
      date: '2026-10-18',
      deleted: ['p-aaaaaaaa'],
      entries: [
        { id: 'p-aaaaaaaa', text: 'deleted one' },
        { id: 'p-bbbbbbbb', text: 'line one\n\n  indented code\n- not a new item' },
        { id: 'p-cccccccc', text: 'unicode ✓ and {{point:p-zzzzzzzz}} and ::llm' },
      ],
    };
    const text = serialiseBacklog(file);
    expect(parseBacklog(text, 'x')).toEqual(file);
    expect(serialiseBacklog(parseBacklog(text, 'x'))).toBe(text);
  });

  it('ignores items without an ID and falls back to the file-name date', () => {
    const f = parseBacklog('- typed elsewhere\n- ok ^p-12345678\n', '2026-01-02');
    expect(f.date).toBe('2026-01-02');
    expect(f.entries).toEqual([{ id: 'p-12345678', text: 'ok' }]);
  });

  it('appends without rewriting existing bytes', () => {
    const odd = '---\ndate: 2026-10-17\ndeleted: []   # keep my comment\n---\n- a ^p-aaaaaaaa';
    const next = appendEntry(odd, '2026-10-17', { id: 'p-bbbbbbbb', text: 'b' });
    expect(next.startsWith(odd)).toBe(true);
    expect(parseBacklog(next, 'x').entries.map((e) => e.id)).toEqual(['p-aaaaaaaa', 'p-bbbbbbbb']);
  });

  it('normalises user input', () => {
    expect(normalisePointText('  hello  \r\n\r\nworld \n\n')).toBe('  hello\n\nworld');
    expect(() => normalisePointText('   \n ')).toThrow(/empty/);
    expect(() => normalisePointText('sneaky ^p-12345678')).toThrow(/block ID/);
    expect(() => normalisePointText('x'.repeat(4001))).toThrow(/limited/);
  });
});

describe('removeEntry (permanent delete)', () => {
  const MULTI = `---
date: 2026-10-17
deleted: []
---
- First point ^p-aaaaaaaa
- Second point
  with a code block:
  \`\`\`
  kubectl get pods
  \`\`\`
  ^p-bbbbbbbb
- Third point ^p-cccccccc
`;

  it('removes a multi-line entry and its tombstone; other entries keep their bytes', () => {
    const disabled = setTombstone(MULTI, '2026-10-17', 'p-bbbbbbbb', true);
    const out = removeEntry(disabled, '2026-10-17', 'p-bbbbbbbb');
    const f = parseBacklog(out, '2026-10-17');
    expect(f.deleted).toEqual([]);
    expect(f.entries.map((e) => e.id)).toEqual(['p-aaaaaaaa', 'p-cccccccc']);
    expect(out).toContain('- First point ^p-aaaaaaaa\n- Third point ^p-cccccccc\n');
    expect(out).not.toContain('kubectl');
  });

  it('refuses an unknown ID', () => {
    expect(() => removeEntry(MULTI, '2026-10-17', 'p-zzzzzzzz')).toThrow(/not found/);
  });
});

describe('isCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(isCalendarDate('2026-10-17')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-1')).toBe(false);
    expect(isCalendarDate('../../x')).toBe(false);
  });
});
