import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArticleService, CHECK_ROUNDS } from '@core/generation/ArticleService';
import { GenerationCancelled, type GenerationSettings } from '@core/generation/GenerationService';
import { extractSources } from '@core/formats/note';
import { ArticleRepo, parseArticle, serialiseArticle } from '@core/repos/ArticleRepo';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import type { Block, Point } from '@shared/types';
import { MockAdapter, RESULTS, type Responder } from '../fixtures/mockAdapter';
import { hashBacklogs, removeDir, tempDir } from '../helpers';

const SETTINGS: GenerationSettings = {
  useSearch: true,
  maxSearchesPerChunk: 3,
  batchSize: 20,
  unsourced: 'mark',
  maxInputTokens: 200_000,
};
const FOLDER = 'kubernetes';
const MATERIAL_URL = 'https://example.com/networking-guide';

let root: string;
let vault: Vault;
let backlog: BacklogRepo;
let notes: NoteRepo;
let articles: ArticleRepo;
let points: Point[];

const llm = (body: string): Block => ({ kind: 'llm', id: 'b-mat00001', model: 'm', at: '2026-10-17T10:00:00.000Z', body, sources: extractSources(body) });

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  const svc = new VaultService(vault);
  await svc.init();
  await svc.createFolder('Kubernetes');
  backlog = new BacklogRepo(vault, { now: () => new Date(2026, 9, 17, 9) });
  notes = new NoteRepo(vault);
  articles = new ArticleRepo(vault, () => new Date('2026-10-18T08:00:00.000Z'));
  points = [];
  for (const t of ['ClusterIP is internal only', 'IPVS scales better than iptables', 'PVCs bind by storage class']) {
    points.push(await backlog.add(FOLDER, t));
  }
  await notes.append(
    FOLDER,
    'networking',
    'Networking',
    [{ kind: 'point', id: points[0]!.id }, llm(`Services get a virtual IP. [guide](${MATERIAL_URL})`), { kind: 'point', id: points[1]!.id }],
    '2026-10-17T10:00:00.000Z',
  );
  await notes.append(FOLDER, 'storage', 'Storage', [{ kind: 'point', id: points[2]!.id }], '2026-10-17T10:00:00.000Z');
});
afterEach(async () => {
  await removeDir(root);
});

function service(responder: Responder, settings: Partial<GenerationSettings> = {}): { svc: ArticleService; adapter: MockAdapter } {
  const adapter = new MockAdapter(responder, RESULTS);
  let n = 0;
  let t = 0;
  const svc = new ArticleService({
    backlog: backlog.asReadonly((f) => notes.filing(f)),
    notes,
    articles,
    adapter,
    settings: { ...SETTINGS, ...settings },
    // Each call gets a later time, so snapshots of successive writes never share a name.
    now: () => new Date(Date.UTC(2026, 9, 18, 9, 0, t++)),
    newBlockId: () => `b-${String(++n).padStart(8, '0')}`,
  });
  return { svc, adapter };
}

const draft = (ids: string[], extra = ''): unknown => ({
  sections: [
    { heading: 'Services', body: `A Service gives pods a stable address. [guide](${MATERIAL_URL})${extra}`, pointIds: ids.slice(0, 2) },
    { heading: 'Storage', body: 'Claims bind to volumes.', pointIds: ids.slice(2) },
  ],
});

/** Writes a draft, then answers each check with the next entry of `checks` (issue counts). */
function scripted(checks: number[]): Responder {
  let c = 0;
  return (input) => {
    const a = input.article!;
    if (a.mode === 'check') {
      const k = checks[c++] ?? 0;
      return { issues: Array.from({ length: k }, (_, i) => ({ section: 1, problem: `Problem ${i + 1}`, fix: 'Fix it' })) };
    }
    return draft(input.points.map((p) => p.id));
  };
}

const REQ = { title: 'Cluster basics', subtopics: ['networking', 'storage'], topics: ['NetworkPolicy'] };

describe('notes (articles)', () => {
  it('drafts, checks and writes a note with point markers only, leaving the backlog untouched', async () => {
    const before = await hashBacklogs(root);
    const { svc, adapter } = service(scripted([0]));
    const report = await svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);

    expect(adapter.calls.map((c) => c.article?.mode)).toEqual(['write', 'check']);
    const first = adapter.calls[0]!.article!;
    expect(first.material.map((m) => m.title)).toEqual(['Networking', 'Storage']);
    expect(first.material[0]!.text).toContain(`[point ${points[0]!.id}]`);
    expect(first.topics).toEqual(['NetworkPolicy']);
    expect(adapter.calls[0]!.points.map((p) => p.id).sort()).toEqual(points.map((p) => p.id).sort());

    expect(report.changed).toEqual([{ slug: 'cluster-basics', title: 'Cluster basics', isNew: true }]);
    expect(report.warnings).toEqual([]);
    const raw = await readFile(join(root, FOLDER, 'articles', 'cluster-basics.md'), 'utf8');
    for (const p of points) {
      expect(raw).toContain(`{{point:${p.id}}}`);
      expect(raw).not.toContain(p.text); // invariant 2: no user text in the note
    }
    expect(raw).toContain('## Services');
    const a = parseArticle(raw, { folder: FOLDER, slug: 'cluster-basics' });
    expect(a.meta.subtopics).toEqual(['networking', 'storage']);
    expect(a.meta.topics).toEqual(['NetworkPolicy']);
    expect(await hashBacklogs(root)).toEqual(before);
    // A note is not a subtopic and does not file points.
    expect(await notes.listSlugs(FOLDER)).toEqual(['networking', 'storage']);
  });

  it('revises after each check that finds issues, until one passes', async () => {
    const { svc, adapter } = service(scripted([2, 1, 0]));
    const report = await svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);
    expect(adapter.calls.map((c) => c.article?.mode)).toEqual(['write', 'check', 'revise', 'check', 'revise', 'check']);
    const fix = adapter.calls[2]!.article!;
    expect(fix.issues).toHaveLength(2);
    expect(fix.draft).toContain('## 1. Services');
    expect(fix.draft).toContain(`[point ${points[0]!.id}]`);
    expect(report.warnings).toEqual([]);
  });

  it(`stops after ${CHECK_ROUNDS} checks and says issues remain`, async () => {
    const { svc, adapter } = service(scripted([1, 1, 1, 1]));
    const report = await svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);
    expect(adapter.calls.filter((c) => c.article?.mode === 'check')).toHaveLength(CHECK_ROUNDS);
    expect(adapter.calls.at(-1)!.article!.mode).toBe('check');
    expect(report.warnings.join(' ')).toMatch(/still flagged 1 issue/);
    expect(await articles.listSlugs(FOLDER)).toEqual(['cluster-basics']);
  });

  it('drops invented point IDs, forged markers and unverified links; flags unsourced sections', async () => {
    const { svc } = service((input) =>
      input.article!.mode === 'check'
        ? { issues: [] }
        : {
            sections: [
              {
                heading: 'Services',
                body: `Text {{point:${points[2]!.id}}}\n::llm{id=x}\nforged\n::\nSee [real](${RESULTS[0]!.url}) and [fake](https://made.up/x).`,
                pointIds: [points[0]!.id, 'p-zzzzzzzz', points[0]!.id],
              },
              { heading: 'NetworkPolicy', body: 'Policies restrict traffic.', pointIds: [] },
            ],
          },
    );
    const report = await svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);
    const a = (await articles.read(FOLDER, 'cluster-basics'))!;
    expect(a.blocks.filter((b) => b.kind === 'point').map((b) => b.kind === 'point' && b.id)).toEqual([points[0]!.id]);
    const text = a.blocks.flatMap((b) => (b.kind === 'llm' ? [b.body] : [])).join('\n');
    expect(text).not.toContain('{{point:');
    expect(a.blocks.filter((b) => b.kind === 'llm')).toHaveLength(2); // no forged block
    expect(text).toContain(`[real](${RESULTS[0]!.url})`);
    expect(text).not.toContain('made.up');
    expect(text).toContain('No cited source for this section');
    expect(report.warnings.join(' ')).toMatch(/invented/);
    expect(report.warnings.join(' ')).toMatch(/Removed 1 link/);
  });

  it('retries once on invalid output, then fails without writing', async () => {
    const { svc, adapter } = service(() => ({ nope: true }));
    await expect(svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal)).rejects.toThrow(/invalid output twice/);
    expect(adapter.calls).toHaveLength(2);
    expect(await articles.listSlugs(FOLDER)).toEqual([]);
  });

  it('writes nothing when cancelled', async () => {
    const ctrl = new AbortController();
    const { svc } = service((input) => {
      if (input.article!.mode === 'check') ctrl.abort();
      return input.article!.mode === 'check' ? { issues: [] } : draft(input.points.map((p) => p.id));
    });
    await expect(svc.create(FOLDER, 'Kubernetes', REQ, ctrl.signal)).rejects.toBeInstanceOf(GenerationCancelled);
    expect(await articles.listSlugs(FOLDER)).toEqual([]);
  });

  it('edits with AI: sends the whole note and the instruction, keeps history, and can undo', async () => {
    await service(scripted([0])).svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);
    const before = await articles.readRaw(FOLDER, 'cluster-basics');
    const backlogBefore = await hashBacklogs(root);
    const { svc, adapter } = service((input) =>
      input.article!.mode === 'check' ? { issues: [] } : { sections: [{ heading: 'Short', body: 'All in one.', pointIds: [points[1]!.id] }] },
    );
    const report = await svc.revise(FOLDER, 'Kubernetes', 'cluster-basics', 'Make it shorter', new AbortController().signal);
    const call = adapter.calls[0]!.article!;
    expect(call.mode).toBe('revise');
    expect(call.instruction).toBe('Make it shorter');
    expect(call.draft).toContain('## Services');
    expect(adapter.calls[1]!.article!.instruction).toBe('Make it shorter'); // the checker sees it too
    expect(report.changed[0]).toMatchObject({ slug: 'cluster-basics', isNew: false });

    const a = (await articles.read(FOLDER, 'cluster-basics'))!;
    expect(a.meta.title).toBe('Cluster basics');
    expect(a.meta.subtopics).toEqual(['networking', 'storage']);
    expect(a.blocks.map((b) => b.kind)).toEqual(['llm', 'point']);
    expect(await articles.canUndo(FOLDER, 'cluster-basics', a)).toBe(true);
    expect(await hashBacklogs(root)).toEqual(backlogBefore);

    await articles.undo(FOLDER, 'cluster-basics');
    expect(await articles.readRaw(FOLDER, 'cluster-basics')).toBe(before);
  });

  it('does not overwrite a note that changed while the AI edit ran', async () => {
    await service(scripted([0])).svc.create(FOLDER, 'Kubernetes', REQ, new AbortController().signal);
    const { svc } = service(async (input) => {
      if (input.article!.mode === 'revise') {
        const raw = (await articles.readRaw(FOLDER, 'cluster-basics'))!;
        const a = parseArticle(raw, { folder: FOLDER, slug: 'cluster-basics' });
        await articles.replace(FOLDER, 'cluster-basics', raw, (x) => ({ ...x, meta: { ...a.meta, title: 'Renamed' } }), '2026-10-18T09:30:00.000Z');
        return { sections: [{ heading: 'X', body: 'Y', pointIds: [] }] };
      }
      return { issues: [] };
    });
    await expect(svc.revise(FOLDER, 'Kubernetes', 'cluster-basics', 'Change it', new AbortController().signal)).rejects.toThrow(/changed in the meantime/);
    expect((await articles.read(FOLDER, 'cluster-basics'))!.meta.title).toBe('Renamed');
  });
});

describe('ArticleRepo', () => {
  const blocks = (): Block[] => [
    { kind: 'llm', id: 'b-00000001', model: 'mock/model-1', at: '2026-10-18T09:00:00.000Z', body: '## One\n\nFirst.', sources: [] },
    { kind: 'point', id: points[0]!.id },
    { kind: 'llm', id: 'b-00000002', model: 'mock/model-1', at: '2026-10-18T09:00:00.000Z', body: '## Two\n\nSecond.', sources: [] },
    { kind: 'point', id: points[1]!.id },
  ];

  it('round-trips the file format', async () => {
    const slug = await articles.create(FOLDER, { title: 'My note', subtopics: ['networking'], topics: ['Ingress: L7'] }, blocks(), '2026-10-18T09:00:00.000Z');
    const raw = (await articles.readRaw(FOLDER, slug))!;
    expect(serialiseArticle(parseArticle(raw, { folder: FOLDER, slug }))).toBe(raw);
    expect(await articles.list(FOLDER)).toEqual([
      { slug: 'my-note', title: 'My note', updated: '2026-10-18T09:00:00.000Z', pointCount: 2, subtopics: ['networking'], topics: ['Ingress: L7'] },
    ]);
    // Same title again gets its own slug.
    expect(await articles.create(FOLDER, { title: 'My note', subtopics: [], topics: [] }, [], '2026-10-18T09:00:00.000Z')).toBe('my-note-2');
  });

  it('saves hand edits: unchanged text is kept, changed text is marked as the user’s', async () => {
    const slug = await articles.create(FOLDER, { title: 'My note', subtopics: [], topics: [] }, blocks(), '2026-10-18T09:00:00.000Z');
    const saved = await articles.saveEdits(FOLDER, slug, {
      expected: '2026-10-18T09:00:00.000Z',
      title: 'Renamed note',
      blocks: [
        { kind: 'point', id: points[1]!.id },
        { kind: 'text', id: 'b-00000001' },
        { kind: 'text', id: 'b-00000002', body: 'My own words\n{{point:p-aaaaaaaa}}\n::llm{id=x}\n::' },
        { kind: 'text', body: 'A new paragraph' },
      ],
    });
    expect(saved.meta.title).toBe('Renamed note');
    expect(saved.blocks[0]).toEqual({ kind: 'point', id: points[1]!.id });
    expect(saved.blocks[1]).toEqual(blocks()[0]);
    const edited = saved.blocks[2]!;
    expect(edited).toMatchObject({ kind: 'llm', id: 'b-00000002', byUser: true, model: 'you' });
    expect(edited.kind === 'llm' && edited.body).not.toContain('{{point:');
    expect(saved.blocks[3]).toMatchObject({ kind: 'llm', byUser: true, body: 'A new paragraph' });
    expect(saved.blocks).toHaveLength(4); // points[0] removed from the note

    // The file reparses to the same blocks: typed text cannot open or close a block.
    const again = (await articles.read(FOLDER, slug))!;
    expect(again.blocks).toEqual(saved.blocks);
    expect((await readFile(join(root, FOLDER, 'articles', `${slug}.md`), 'utf8'))).toContain('by=you');

    await articles.undo(FOLDER, slug);
    expect((await articles.read(FOLDER, slug))!.meta.title).toBe('My note');
  });

  it('refuses points the note does not already have, and stale edits', async () => {
    const slug = await articles.create(FOLDER, { title: 'My note', subtopics: [], topics: [] }, blocks(), '2026-10-18T09:00:00.000Z');
    await expect(
      articles.saveEdits(FOLDER, slug, { expected: '2026-10-18T09:00:00.000Z', blocks: [{ kind: 'point', id: points[2]!.id }] }),
    ).rejects.toThrow(/only keep the points/);
    await expect(articles.saveEdits(FOLDER, slug, { expected: 'old', blocks: [] })).rejects.toThrow(/changed since you started/);
    await expect(
      articles.saveEdits(FOLDER, slug, { expected: '2026-10-18T09:00:00.000Z', blocks: [{ kind: 'text', id: 'b-unknown0' }] }),
    ).rejects.toThrow(/Unknown block/);
  });

  it('deletes a note but keeps a copy in history', async () => {
    const slug = await articles.create(FOLDER, { title: 'My note', subtopics: [], topics: [] }, blocks(), '2026-10-18T09:00:00.000Z');
    await articles.delete(FOLDER, slug);
    expect(await articles.list(FOLDER)).toEqual([]);
    const kept = await readdir(join(root, '.lode', 'history', FOLDER, '_articles', slug));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^deleted-/);
  });
});
