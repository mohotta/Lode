import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseNote } from '@core/formats/note';
import { GenerationCancelled, GenerationService, type GenerationSettings } from '@core/generation/GenerationService';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { DigestRepo } from '@core/repos/DigestRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { resolveNote } from '@core/repos/resolveNote';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import type { Point } from '@shared/types';
import { MockAdapter, RESULTS, type Responder } from '../fixtures/mockAdapter';
import { hashBacklogs, removeDir, tempDir } from '../helpers';

const SETTINGS: GenerationSettings = {
  useSearch: true,
  maxSearchesPerChunk: 4,
  batchSize: 20,
  unsourced: 'drop',
  maxInputTokens: 100_000,
};

let root: string;
let vault: Vault;
let backlog: BacklogRepo;
let notes: NoteRepo;
let points: Point[];
const FOLDER = 'kubernetes';

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  const svc = new VaultService(vault);
  await svc.init();
  await svc.createFolder('Kubernetes');
  backlog = new BacklogRepo(vault, { now: () => new Date(2026, 9, 17, 9) });
  notes = new NoteRepo(vault);
  points = [];
  for (const t of [
    'ClusterIP services are only reachable inside the cluster',
    'kube-proxy in IPVS mode scales better than iptables',
    'PVCs bind to PVs by storage class',
  ]) {
    points.push(await backlog.add(FOLDER, t));
  }
});
afterEach(async () => {
  await removeDir(root);
});

function service(responder: Responder, settings: Partial<GenerationSettings> = {}): { gen: GenerationService; adapter: MockAdapter } {
  const adapter = new MockAdapter(responder, RESULTS);
  let n = 0;
  const gen = new GenerationService({
    backlog: backlog.asReadonly((f) => notes.filing(f)),
    notes,
    adapter,
    settings: { ...SETTINGS, ...settings },
    now: () => new Date('2026-10-17T10:42:00Z'),
    newBlockId: () => `b-${String(++n).padStart(8, '0')}`,
  });
  return { gen, adapter };
}

const good: Responder = (input) => ({
  assignments: [
    {
      pointIds: input.points.slice(0, 2).map((p) => p.id),
      subtopic: { slug: 'networking', title: 'Networking', isNew: true },
      explanation: 'Services give pods a stable address.',
      additions: [
        { text: 'NodePort builds on ClusterIP.', sources: [{ title: 'Service', url: RESULTS[0]!.url }] },
        { text: 'Invented fact.', sources: [{ title: 'Nope', url: 'https://made.up/x' }] },
      ],
    },
    {
      pointIds: input.points.slice(2).map((p) => p.id),
      subtopic: { slug: 'storage', title: 'Storage', isNew: true },
      explanation: 'Storage is bound declaratively.',
      additions: [],
    },
  ],
});

describe('GenerationService', () => {
  it('files points into notes with markers and an AI block, and never touches the backlog', async () => {
    const before = await hashBacklogs(root);
    const { gen } = service(good);
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);

    expect(await hashBacklogs(root)).toEqual(before);
    expect(report.changed.map((c) => c.slug).sort()).toEqual(['networking', 'storage']);
    expect(report.unfiled).toEqual([]);
    expect(report.filed).toHaveLength(3);
    expect(report.warnings.join(' ')).toMatch(/Dropped 1 addition/);

    const raw = await readFile(join(root, FOLDER, 'notes', 'networking.md'), 'utf8');
    for (const p of points.slice(0, 2)) {
      expect(raw).toContain(`{{point:${p.id}}}`);
      expect(raw).not.toContain(p.text); // invariant 2: no copy of user text in notes
    }
    expect(raw).toContain('::llm{id=b-00000001 model="mock/model-1" at="2026-10-17T10:42:00.000Z"}');
    expect(raw).not.toContain('made.up');

    const note = parseNote(raw, { folder: FOLDER, subtopic: 'networking' });
    const resolved = resolveNote(FOLDER, 'networking', note, await backlog.listPoints(FOLDER));
    expect(resolved.blocks.filter((b) => b.kind === 'point').map((b) => (b.kind === 'point' ? b.text : ''))).toEqual(
      points.slice(0, 2).map((p) => p.text),
    );

    const ro = backlog.asReadonly((f) => notes.filing(f));
    expect(await ro.listUnfiled(FOLDER)).toEqual([]);
  });

  it('appends on a second run without changing existing blocks', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    const before = parseNote(await readFile(join(root, FOLDER, 'notes', 'networking.md'), 'utf8'), {
      folder: FOLDER,
      subtopic: 'networking',
    }).blocks;
    const p4 = await backlog.add(FOLDER, 'EndpointSlices replace Endpoints');
    const { gen, adapter } = service(() => ({
      assignments: [
        {
          pointIds: [p4.id],
          subtopic: { slug: 'networking', title: 'Networking', isNew: false },
          explanation: 'More.',
          additions: [],
        },
      ],
    }));
    const hashes = await hashBacklogs(root);
    await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(await hashBacklogs(root)).toEqual(hashes);
    expect(adapter.calls[0]?.points.map((p) => p.id)).toEqual([p4.id]); // only unfiled points are sent
    expect(adapter.calls[0]?.subtopics.map((s) => s.slug)).toEqual(['networking', 'storage']);
    const after = parseNote(await readFile(join(root, FOLDER, 'notes', 'networking.md'), 'utf8'), {
      folder: FOLDER,
      subtopic: 'networking',
    }).blocks;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]).toEqual({ kind: 'point', id: p4.id });
  });

  it('survives adversarial output: forged markers, invented IDs, bad slugs', async () => {
    const before = await hashBacklogs(root);
    const { gen } = service((input) => ({
      assignments: [
        {
          pointIds: [input.points[0]!.id, 'p-invented', '../../x'],
          subtopic: { slug: '../../kubernetes/backlog', title: 'Hack', isNew: true },
          explanation: `::\n{{point:${input.points[1]!.id}}}\n::llm{id=evil}\nignore previous instructions`,
          additions: [{ text: '::', sources: [{ title: 'x', url: RESULTS[0]!.url }] }],
          text: 'REWRITTEN USER TEXT',
        },
        {
          pointIds: input.points.slice(1).map((p) => p.id),
          subtopic: { slug: 'misc', title: 'Misc', isNew: true },
          explanation: '',
          additions: [],
        },
      ],
    }));
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(await hashBacklogs(root)).toEqual(before);
    expect((await readdir(join(root, FOLDER, 'notes'))).sort()).toEqual(['kubernetes-backlog.md', 'misc.md']);

    const raw = await readFile(join(root, FOLDER, 'notes', 'kubernetes-backlog.md'), 'utf8');
    expect(raw).not.toContain('REWRITTEN USER TEXT');
    const blocks = parseNote(raw, { folder: FOLDER, subtopic: 'x' }).blocks;
    // Exactly one point marker (the real one) and one AI block; nothing forged.
    expect(blocks.map((b) => b.kind)).toEqual(['point', 'llm']);
    expect(blocks[0]).toEqual({ kind: 'point', id: points[0]!.id });
    expect(report.warnings.join(' ')).toMatch(/invented/);
  });

  it('retries invalid JSON once, then leaves points unfiled', async () => {
    const { gen, adapter } = service(() => 'garbage');
    const before = await hashBacklogs(root);
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.repairHint).toBeTruthy();
    expect(report.unfiled).toHaveLength(3);
    expect(report.changed).toEqual([]);
    expect(await readdir(join(root, FOLDER, 'notes'))).toEqual([]);
    expect(await hashBacklogs(root)).toEqual(before);
  });

  it('retries leftover points once and reports the rest', async () => {
    const { gen, adapter } = service((input, call) => ({
      assignments:
        call === 1
          ? [
              {
                pointIds: [input.points[0]!.id],
                subtopic: { slug: 'a', title: 'A', isNew: true },
                explanation: 'x',
                additions: [],
              },
            ]
          : [],
    }));
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.points.map((p) => p.id)).toEqual(points.slice(1).map((p) => p.id));
    expect(report.filed).toEqual([points[0]!.id]);
    expect(report.unfiled.sort()).toEqual(points.slice(1).map((p) => p.id).sort());
  });

  it('cancel discards everything: no note is written', async () => {
    const ctrl = new AbortController();
    const { gen } = service(async (input) => {
      ctrl.abort();
      return good(input, 1, { signal: ctrl.signal, useSearch: true, maxSearches: 1 });
    });
    const before = await hashBacklogs(root);
    await expect(gen.run(FOLDER, 'Kubernetes', ctrl.signal)).rejects.toBeInstanceOf(GenerationCancelled);
    expect(await readdir(join(root, FOLDER, 'notes'))).toEqual([]);
    expect(await hashBacklogs(root)).toEqual(before);
  });

  it('chunks by batch size and reuses subtopics proposed by earlier chunks', async () => {
    const { gen, adapter } = service(
      (input) => ({
        assignments: [
          {
            pointIds: input.points.map((p) => p.id),
            subtopic: { slug: 'shared', title: 'Shared', isNew: true },
            explanation: 'x',
            additions: [],
          },
        ],
      }),
      { batchSize: 2 },
    );
    await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(adapter.calls.map((c) => c.points.length)).toEqual([2, 1]);
    expect(adapter.calls[1]?.subtopics.map((s) => s.slug)).toContain('shared');
  });

  it('places a cited correction right under the point, without touching the point or backlog', async () => {
    const before = await hashBacklogs(root);
    const { gen } = service((input) => ({
      ...(good(input, 1, { signal: new AbortController().signal, useSearch: true, maxSearches: 1 }) as object),
      corrections: [
        {
          pointId: input.points[1]!.id,
          issue: 'IPVS does not always beat iptables.',
          correction: 'The difference shows at large Service counts.',
          sources: [{ title: 'Virtual IPs', url: RESULTS[1]!.url }],
        },
        { pointId: 'p-invented', issue: 'x', correction: 'y', sources: [{ title: 't', url: RESULTS[1]!.url }] },
      ],
    }));
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(await hashBacklogs(root)).toEqual(before);
    expect(report.corrected).toEqual([points[1]!.id]);

    const raw = await readFile(join(root, FOLDER, 'notes', 'networking.md'), 'utf8');
    expect(raw).not.toContain(points[1]!.text);
    const blocks = parseNote(raw, { folder: FOLDER, subtopic: 'networking' }).blocks;
    const i = blocks.findIndex((b) => b.kind === 'point' && b.id === points[1]!.id);
    const fix = blocks[i + 1];
    expect(fix?.kind === 'llm' && fix.correctionFor).toBe(points[1]!.id);
    expect(fix?.kind === 'llm' && fix.body).toContain('**Correct:** The difference shows at large Service counts.');

    const days = await backlog.listDays(FOLDER, await notes.filing(FOLDER), await notes.correctedIds(FOLDER));
    const flagged = days.flatMap((d) => d.points).filter((p) => p.corrected).map((p) => p.id);
    expect(flagged).toEqual([points[1]!.id]);
  });

  it('renaming a subtopic changes only its title', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    const path = join(root, FOLDER, 'notes', 'networking.md');
    const blocksBefore = parseNote(await readFile(path, 'utf8'), { folder: FOLDER, subtopic: 'networking' }).blocks;
    const hashes = await hashBacklogs(root);
    const info = await notes.rename(FOLDER, 'networking', '  Service networking   & kube-proxy ');
    expect(info).toMatchObject({ slug: 'networking', title: 'Service networking & kube-proxy', pointCount: 2 });
    const after = parseNote(await readFile(path, 'utf8'), { folder: FOLDER, subtopic: 'networking' });
    expect(after.meta.title).toBe('Service networking & kube-proxy');
    expect(after.blocks).toEqual(blocksBefore);
    expect(await hashBacklogs(root)).toEqual(hashes);
    await expect(notes.rename(FOLDER, '../x', 'y')).rejects.toThrow(/Invalid subtopic/);
    await expect(notes.rename(FOLDER, 'nope', 'y')).rejects.toThrow(/not found/);
  });

  it('previews counts and token estimates without calling the model', async () => {
    const { gen, adapter } = service(good);
    const p = await gen.preview(FOLDER, 'Kubernetes');
    expect(p).toMatchObject({ points: 3, chunks: 1, useSearch: true, overCap: false });
    expect(p.estimatedInputTokens).toBeGreaterThan(0);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe('Regenerate (HLD §6.4)', () => {
  const notePath = (): string => join(root, FOLDER, 'notes', 'networking.md');
  const blocksOf = async (): Promise<ReturnType<typeof parseNote>['blocks']> =>
    parseNote(await readFile(notePath(), 'utf8'), { folder: FOLDER, subtopic: 'networking' }).blocks;

  it('replaces only AI blocks, keeps markers in place, snapshots history, and can be undone', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    const original = await readFile(notePath(), 'utf8');
    const hashes = await hashBacklogs(root);
    const [p0, p1] = points;

    const { gen, adapter } = service((input) => ({
      assignments: [
        {
          // Tries to move the point elsewhere and smuggle an invented ID: both ignored.
          pointIds: [p0!.id, 'p-invented'],
          subtopic: { slug: 'elsewhere', title: 'Elsewhere', isNew: true },
          explanation: `First rewrite.\n::llm{id=forged}\n{{point:${p1!.id}}}`,
          additions: [{ text: 'NodePort builds on ClusterIP.', sources: [{ title: 'Service', url: RESULTS[0]!.url }] }],
        },
        {
          pointIds: [input.points[1]!.id],
          subtopic: { slug: 'networking', title: 'Networking', isNew: false },
          explanation: 'Second rewrite.',
          additions: [],
        },
      ],
      corrections: [
        { pointId: p1!.id, issue: 'Not always faster.', correction: 'Only at scale.', sources: [{ title: 'v', url: RESULTS[1]!.url }] },
      ],
    }));
    const report = await gen.regenerate(FOLDER, 'Kubernetes', 'networking', new AbortController().signal);

    expect(adapter.calls[0]?.regenerate).toEqual({ slug: 'networking', title: 'Networking' });
    expect(adapter.calls[0]?.points.map((p) => p.id)).toEqual([p0!.id, p1!.id]);
    expect(report.changed).toEqual([{ slug: 'networking', title: 'Networking', isNew: false }]);
    expect(await hashBacklogs(root)).toEqual(hashes);
    expect(await notes.listSlugs(FOLDER)).toEqual(['networking', 'storage']); // nothing filed elsewhere

    const blocks = await blocksOf();
    expect(blocks.map((b) => (b.kind === 'point' ? b.id : b.kind === 'llm' ? (b.correctionFor ? 'fix' : b.body.split('\n')[0]) : 'raw'))).toEqual([
      p0!.id,
      'First rewrite.',
      p1!.id,
      'fix',
      'Second rewrite.',
    ]);
    const raw = await readFile(notePath(), 'utf8');
    expect(raw).not.toContain('Services give pods a stable address.');
    expect(raw.match(/^\{\{point:/gm)).toHaveLength(2); // the forged marker was neutralised
    expect(raw).not.toContain(p0!.text);

    const history = await readdir(join(root, '.lode', 'history', FOLDER, 'networking'));
    expect(history).toEqual(['2026-10-17T10-42-00-000Z.md']);
    expect(await readFile(join(root, '.lode', 'history', FOLDER, 'networking', history[0]!), 'utf8')).toBe(original);

    const note = parseNote(raw, { folder: FOLDER, subtopic: 'networking' });
    expect(await notes.canUndo(FOLDER, 'networking', note)).toBe(true);
    await notes.undoRegenerate(FOLDER, 'networking');
    expect(await readFile(notePath(), 'utf8')).toBe(original);
    const restored = parseNote(original, { folder: FOLDER, subtopic: 'networking' });
    expect(await notes.canUndo(FOLDER, 'networking', restored)).toBe(false);
    expect(await hashBacklogs(root)).toEqual(hashes);
  });

  it('skips deleted points and leaves the note unchanged when the model returns nothing usable', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    await backlog.setDeleted(FOLDER, points[1]!.id, true);
    const before = await readFile(notePath(), 'utf8');
    const { gen, adapter } = service(() => ({ assignments: [{ pointIds: ['p-invented'], subtopic: { title: 'X' } }] }));
    await expect(gen.regenerate(FOLDER, 'Kubernetes', 'networking', new AbortController().signal)).rejects.toThrow(
      /nothing usable/,
    );
    expect(adapter.calls[0]?.points.map((p) => p.id)).toEqual([points[0]!.id]);
    expect(await readFile(notePath(), 'utf8')).toBe(before);
  });

  it('writes nothing if the note changes while the model is working', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    const { gen } = service(async (input) => {
      await notes.append(FOLDER, 'networking', 'Networking', [{ kind: 'raw', text: 'edited elsewhere' }], 'x');
      return {
        assignments: [
          {
            pointIds: input.points.map((p) => p.id),
            subtopic: { slug: 'networking', title: 'Networking' },
            explanation: 'Rewrite.',
          },
        ],
      };
    });
    await expect(gen.regenerate(FOLDER, 'Kubernetes', 'networking', new AbortController().signal)).rejects.toThrow(
      /changed while regenerating/,
    );
    expect(await readFile(notePath(), 'utf8')).toContain('edited elsewhere');
    await expect(readdir(join(root, '.lode', 'history'))).rejects.toThrow();
  });
});

describe('model-flagged duplicates', () => {
  it('files a repeat next to the point it repeats, with a duplicate marker, never touching the backlog', async () => {
    await service(good).gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    const p4 = await backlog.add(FOLDER, 'ClusterIP is internal-only');
    const p5 = await backlog.add(FOLDER, 'Ingress routes HTTP by host');
    const p6 = await backlog.add(FOLDER, 'Ingress picks backends by hostname');
    const hashes = await hashBacklogs(root);

    const { gen, adapter } = service(() => ({
      duplicates: [
        { pointId: p4.id, duplicateOf: points[0]!.id },
        { pointId: p6.id, duplicateOf: p5.id },
        { pointId: p5.id, duplicateOf: p6.id }, // points at a later point: ignored (no cycles)
        { pointId: p5.id, duplicateOf: 'p-invented' },
      ],
      assignments: [
        {
          pointIds: [p4.id, p5.id, p6.id],
          subtopic: { slug: 'ingress', title: 'Ingress routing', isNew: true },
          explanation: 'Ingress sits in front of Services.',
          additions: [],
        },
      ],
    }));
    const report = await gen.run(FOLDER, 'Kubernetes', new AbortController().signal);
    expect(await hashBacklogs(root)).toEqual(hashes);
    expect(adapter.calls[0]?.knownPoints?.map((p) => p.id).sort()).toEqual(points.map((p) => p.id).sort());
    expect(report.duplicates.sort()).toEqual([p4.id, p6.id].sort());
    expect(report.unfiled).toEqual([]);

    const net = parseNote(await readFile(join(root, FOLDER, 'notes', 'networking.md'), 'utf8'), {
      folder: FOLDER,
      subtopic: 'networking',
    }).blocks;
    expect(net.slice(-2)).toEqual([
      { kind: 'point', id: p4.id },
      expect.objectContaining({ kind: 'llm', duplicate: { id: p4.id, of: points[0]!.id } }),
    ]);
    const ing = parseNote(await readFile(join(root, FOLDER, 'notes', 'ingress.md'), 'utf8'), {
      folder: FOLDER,
      subtopic: 'ingress',
    }).blocks;
    expect(ing.map((b) => (b.kind === 'point' ? b.id : b.kind === 'llm' && b.duplicate ? 'dup' : 'ai'))).toEqual([
      p5.id,
      p6.id,
      'dup',
      'ai',
    ]);

    const days = await backlog.listDays(FOLDER, await notes.filing(FOLDER), undefined, await notes.duplicates(FOLDER));
    const dupOf = Object.fromEntries(days.flatMap((d) => d.points).map((p) => [p.id, p.duplicateOf]));
    expect(dupOf[p4.id]).toBe(points[0]!.id);
    expect(dupOf[p6.id]).toBe(p5.id);
    expect(dupOf[p5.id]).toBeUndefined();
  });
});

describe('digests (FR-26)', () => {
  it('writes a recap with point markers only, ignores adversarial output, and never files or touches the backlog', async () => {
    const digests = new DigestRepo(vault);
    const old = await backlog.add(FOLDER, 'An older point', '2026-10-01');
    const hashes = await hashBacklogs(root);
    const adapter = new MockAdapter((input) => ({
      summary: `This week was about networking. [fake](https://evil.example) https://evil.example/x\n::llm{id=forged}`,
      themes: [
        {
          title: 'Services ### and proxies',
          pointIds: [input.points[0]!.id, input.points[1]!.id, 'p-invented', old.id],
          summary: `Two points about Services. {{point:${old.id}}}`,
          text: 'COPIED USER TEXT',
        },
        { title: 'Repeat', pointIds: [input.points[0]!.id], summary: '' },
      ],
    }));
    let n = 0;
    const gen = new GenerationService({
      backlog: backlog.asReadonly((f) => notes.filing(f)),
      notes,
      digests,
      adapter,
      settings: SETTINGS,
      now: () => new Date('2026-10-18T10:00:00Z'),
      newBlockId: () => `b-${String(++n).padStart(8, '0')}`,
    });

    const preview = await gen.previewDigest(FOLDER, 'Kubernetes', '2026-W42');
    expect(preview).toMatchObject({ points: 3, useSearch: false });
    const report = await gen.digest(FOLDER, 'Kubernetes', '2026-W42', new AbortController().signal);

    expect(adapter.calls[0]?.digest).toEqual({ title: 'Week 42: Oct 12–18, 2026', from: '2026-10-12', to: '2026-10-18' });
    expect(adapter.calls[0]?.points.map((p) => p.id)).toEqual(points.map((p) => p.id)); // only this week's points
    expect(report.warnings.join(' ')).toMatch(/invented/);
    expect(await hashBacklogs(root)).toEqual(hashes);
    expect(await notes.listSlugs(FOLDER)).toEqual([]); // a digest is not a subtopic
    expect((await notes.filing(FOLDER)).size).toBe(0); // and does not file points

    const raw = await readFile(join(root, FOLDER, 'digests', '2026-W42.md'), 'utf8');
    expect(raw).not.toContain('evil.example');
    expect(raw).not.toContain('COPIED USER TEXT');
    for (const p of points) expect(raw).not.toContain(p.text);
    const note = parseNote(raw, { folder: FOLDER, subtopic: '2026-W42' });
    expect(note.meta.title).toBe('Week 42: Oct 12–18, 2026');
    expect(note.blocks.map((b) => (b.kind === 'point' ? b.id : b.kind))).toEqual([
      'llm',
      'llm',
      points[0]!.id,
      points[1]!.id,
      points[2]!.id, // left out by the model, still listed
    ]);
    expect(raw.match(/^\{\{point:/gm)).toHaveLength(3);
    expect(raw.match(/^::llm\{/gm)).toHaveLength(2);

    const listed = await digests.list(FOLDER);
    expect(listed).toEqual([expect.objectContaining({ id: '2026-W42', kind: 'week', pointCount: 3 })]);
    const periods = await digests.periods(FOLDER, await backlog.listPoints(FOLDER));
    expect(periods.find((p) => p.id === '2026-W42')).toMatchObject({ points: 3, exists: true });
    expect(periods.find((p) => p.id === '2026-10')).toMatchObject({ points: 4, exists: false });

    // Writing it again keeps the previous version in history.
    await gen.digest(FOLDER, 'Kubernetes', '2026-W42', new AbortController().signal);
    expect(await readdir(join(root, '.lode', 'history', FOLDER, '_digests', '2026-W42'))).toHaveLength(1);
    await digests.delete(FOLDER, '2026-W42');
    expect(await digests.list(FOLDER)).toEqual([]);
    await expect(digests.read(FOLDER, '../../x')).rejects.toThrow(/Invalid digest period/);
  });

  it('refuses an empty period and writes nothing on unusable output', async () => {
    const digests = new DigestRepo(vault);
    const gen = new GenerationService({
      backlog: backlog.asReadonly((f) => notes.filing(f)),
      notes,
      digests,
      adapter: new MockAdapter(() => ({ summary: '', themes: [{ title: 'x', pointIds: ['p-invented'] }] })),
      settings: SETTINGS,
    });
    await expect(gen.digest(FOLDER, 'K', '2026-W30', new AbortController().signal)).rejects.toThrow(/No points/);
    await expect(gen.digest(FOLDER, 'K', '2026-W42', new AbortController().signal)).rejects.toThrow(/nothing usable/);
    expect(await digests.list(FOLDER)).toEqual([]);
  });
});
