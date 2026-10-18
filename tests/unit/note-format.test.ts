import { describe, expect, it } from 'vitest';
import { appendBlocks, correctedIdsIn, parseNote, retitleNote, serialiseNote } from '@core/formats/note';

const SAMPLE = `---
folder: kubernetes
subtopic: networking
title: Networking
updated: 2026-10-17T10:42:00Z
---

{{point:p-k3x9a2bq}}

::llm{id=b-01 model="provider/model" at="2026-10-17T10:42:00Z"}
ClusterIP is the default Service type. It allocates a virtual IP reachable only inside the cluster...

Also worth knowing:
- NodePort builds on ClusterIP by also opening a port on every node. [src](https://example.com/a)
- Headless Services (clusterIP: None) return pod IPs via DNS instead of a virtual IP. [src](https://example.com/b)
::

{{point:p-m1z7c0de}}
`;

describe('note format', () => {
  it('parses the HLD example into blocks', () => {
    const n = parseNote(SAMPLE, { folder: 'f', subtopic: 's' });
    expect(n.meta).toEqual({
      folder: 'kubernetes',
      subtopic: 'networking',
      title: 'Networking',
      updated: '2026-10-17T10:42:00Z',
    });
    expect(n.blocks.map((b) => b.kind)).toEqual(['point', 'llm', 'point']);
    const llm = n.blocks[1];
    if (llm?.kind !== 'llm') throw new Error('expected llm');
    expect(llm.id).toBe('b-01');
    expect(llm.model).toBe('provider/model');
    expect(llm.sources.map((s) => s.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('round-trips byte for byte', () => {
    expect(serialiseNote(parseNote(SAMPLE, { folder: 'f', subtopic: 's' }))).toBe(SAMPLE);
  });

  it('keeps external text as raw blocks and round-trips them', () => {
    const withRaw = SAMPLE.replace('{{point:p-m1z7c0de}}', 'my own scribble\nsecond line\n\n{{point:p-m1z7c0de}}');
    const n = parseNote(withRaw, { folder: 'f', subtopic: 's' });
    expect(n.blocks.map((b) => b.kind)).toEqual(['point', 'llm', 'raw', 'point']);
    expect(serialiseNote(n)).toBe(withRaw);
  });

  it('only recognises markers as whole lines', () => {
    const n = parseNote('---\ntitle: T\n---\n\nsee {{point:p-k3x9a2bq}} inline\n\nstd::vector\n', {
      folder: 'f',
      subtopic: 's',
    });
    expect(n.blocks).toEqual([
      { kind: 'raw', text: 'see {{point:p-k3x9a2bq}} inline' },
      { kind: 'raw', text: 'std::vector' },
    ]);
  });

  it('appending keeps every existing block identical', () => {
    const before = parseNote(SAMPLE, { folder: 'f', subtopic: 's' });
    const next = appendBlocks(
      SAMPLE,
      { folder: 'kubernetes', subtopic: 'networking', title: 'Networking', updated: '2026-10-18T00:00:00Z' },
      [{ kind: 'point', id: 'p-zzzzzzzz' }],
    );
    const after = parseNote(next, { folder: 'f', subtopic: 's' });
    expect(after.blocks.slice(0, before.blocks.length)).toEqual(before.blocks);
    expect(after.blocks.at(-1)).toEqual({ kind: 'point', id: 'p-zzzzzzzz' });
    expect(after.meta.updated).toBe('2026-10-18T00:00:00Z');
    expect(next.slice(next.indexOf('\n---\n'))).toContain(SAMPLE.slice(SAMPLE.indexOf('\n---\n') + 5).trimEnd());
  });

  it('creates a new note in canonical form', () => {
    const meta = { folder: 'k', subtopic: 'n', title: 'N', updated: '2026-10-18T00:00:00Z' };
    const text = appendBlocks(null, meta, [{ kind: 'point', id: 'p-aaaaaaaa' }]);
    expect(serialiseNote(parseNote(text, { folder: 'k', subtopic: 'n' }))).toBe(text);
  });
});

describe('correction blocks', () => {
  const WITH_FIX = `---
folder: k
subtopic: n
title: N
updated: x
---

{{point:p-aaaaaaaa}}

::llm{id=b-00000002 kind=correction for=p-aaaaaaaa model="m/x" at="t"}
IPVS is not always faster for small clusters.

**Correct:** The gain shows at thousands of Services. [Docs](https://k8s.io/a)
::
`;

  it('round-trips and exposes the point it corrects', () => {
    const n = parseNote(WITH_FIX, { folder: 'k', subtopic: 'n' });
    const fix = n.blocks[1];
    expect(fix?.kind === 'llm' && fix.correctionFor).toBe('p-aaaaaaaa');
    expect(correctedIdsIn(n.blocks)).toEqual(['p-aaaaaaaa']);
    expect(serialiseNote(n)).toBe(WITH_FIX);
  });

  it('ignores a correction pointing at a malformed ID', () => {
    const n = parseNote(WITH_FIX.replace('for=p-aaaaaaaa', 'for=../x'), { folder: 'k', subtopic: 'n' });
    expect(correctedIdsIn(n.blocks)).toEqual([]);
  });
});

describe('retitleNote', () => {
  it('changes only the title and keeps the body byte for byte', () => {
    const next = retitleNote(SAMPLE, {
      folder: 'kubernetes',
      subtopic: 'networking',
      title: 'Service networking & kube-proxy',
      updated: '2026-10-17T10:42:00Z',
    });
    const body = (t: string): string => t.slice(t.indexOf('\n---\n', 4) + 5);
    expect(body(next)).toBe(body(SAMPLE));
    expect(parseNote(next, { folder: 'f', subtopic: 's' }).meta.title).toBe('Service networking & kube-proxy');
  });
});
