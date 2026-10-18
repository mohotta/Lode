import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { ReviewRepo, ageInDays, stageFor } from '@core/repos/ReviewRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import { hashBacklogs, removeDir, tempDir } from '../helpers';

describe('review stages', () => {
  it('counts calendar days across month and DST boundaries', () => {
    expect(ageInDays('2026-10-17', '2026-10-18')).toBe(1);
    expect(ageInDays('2026-02-27', '2026-03-01')).toBe(2);
    expect(ageInDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('maps ages to the 1, 7 and 30 day windows', () => {
    const t = '2026-10-31';
    expect(stageFor('2026-10-31', t)).toBeNull(); // today: not yet
    expect(stageFor('2026-10-30', t)).toBe(1);
    expect(stageFor('2026-10-25', t)).toBe(1);
    expect(stageFor('2026-10-24', t)).toBe(7);
    expect(stageFor('2026-10-02', t)).toBe(7);
    expect(stageFor('2026-10-01', t)).toBe(30);
    expect(stageFor('2026-09-02', t)).toBe(30);
    expect(stageFor('2026-09-01', t)).toBeNull(); // older than the last window
  });
});

let root: string;
let vault: Vault;
let svc: VaultService;
let backlog: BacklogRepo;
let notes: NoteRepo;
let today = new Date(2026, 9, 31, 9);

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  svc = new VaultService(vault);
  await svc.init();
  await svc.createFolder('K8s');
  backlog = new BacklogRepo(vault, { now: () => new Date(2026, 9, 31, 9) });
  notes = new NoteRepo(vault);
  today = new Date(2026, 9, 31, 9);
});
afterEach(async () => {
  await removeDir(root);
});

describe('ReviewRepo', () => {
  it('lists due points with their notes, and marks per stage without touching the backlog', async () => {
    const week = await backlog.add('k8s', 'a week ago', '2026-10-24');
    const month = await backlog.add('k8s', 'a month ago', '2026-10-01');
    const recent = await backlog.add('k8s', 'yesterday', '2026-10-30');
    await backlog.add('k8s', 'today');
    const gone = await backlog.add('k8s', 'deleted', '2026-10-30');
    await backlog.setDeleted('k8s', gone.id, true);
    await writeFile(
      join(root, 'k8s', 'notes', 'svc.md'),
      `---\nfolder: k8s\nsubtopic: svc\ntitle: Services\nupdated: x\n---\n{{point:${week.id}}}\n`,
    );
    const repo = new ReviewRepo(vault, () => today);
    const src = {
      folders: await svc.listFolders(),
      points: (f: string) => backlog.listPoints(f),
      filing: (f: string) => notes.filing(f),
      subtopics: (f: string) => notes.listSubtopics(f),
    };
    const due = await repo.listDue(src);
    expect(due.map((d) => [d.id, d.stage])).toEqual([
      [month.id, 30],
      [week.id, 7],
      [recent.id, 1],
    ]);
    expect(due[1]).toMatchObject({ folderTitle: 'K8s', filedUnder: [{ slug: 'svc', title: 'Services' }] });

    const hashes = await hashBacklogs(root);
    await repo.mark([{ id: week.id, stage: 7 }]);
    expect(await hashBacklogs(root)).toEqual(hashes);
    expect((await repo.listDue(src)).map((d) => d.id)).toEqual([month.id, recent.id]);
    expect(JSON.parse(await readFile(join(root, '.lode', 'review.json'), 'utf8'))).toEqual({
      version: 1,
      reviewed: { [week.id]: { '7': '2026-10-31' } },
    });

    // Reviewing at the 1-day stage does not hide the point when it reaches the 7-day stage.
    await repo.mark([{ id: recent.id, stage: 1 }]);
    today = new Date(2026, 10, 7, 9);
    expect((await repo.listDue(src)).find((d) => d.id === recent.id)?.stage).toBe(7);
  });

  it('survives a corrupt review.json', async () => {
    await backlog.add('k8s', 'x', '2026-10-30');
    await writeFile(join(root, '.lode', 'review.json'), '{not json');
    const repo = new ReviewRepo(vault, () => today);
    const due = await repo.listDue({
      folders: await svc.listFolders(),
      points: (f) => backlog.listPoints(f),
      filing: async () => new Map(),
      subtopics: async () => [],
    });
    expect(due).toHaveLength(1);
  });
});
