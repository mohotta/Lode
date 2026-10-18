import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { TrashRepo } from '@core/repos/TrashRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import { removeDir, tempDir } from '../helpers';

let root: string;
let vault: Vault;
let svc: VaultService;
let backlog: BacklogRepo;
let notes: NoteRepo;
let trash: TrashRepo;
let tick = 0;
const clock = (): Date => new Date(Date.UTC(2026, 9, 17, 9, 0, tick++));

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  svc = new VaultService(vault, clock);
  await svc.init();
  backlog = new BacklogRepo(vault, { now: () => new Date(2026, 9, 17, 9) });
  notes = new NoteRepo(vault, clock);
  trash = new TrashRepo(vault);
  await svc.createFolder('K8s');
});
afterEach(async () => {
  await removeDir(root);
});

const dayFile = (): string => join(root, 'k8s', 'backlog', '2026-10-17.md');

describe('point edit and soft delete (user-initiated backlog writes)', () => {
  it('edits text in place; ID and date stay', async () => {
    const a = await backlog.add('k8s', 'Pods are mortal');
    const b = await backlog.add('k8s', 'Services are stable');
    const edited = await backlog.edit('k8s', a.id, 'Pods are **ephemeral**');
    expect(edited).toMatchObject({ id: a.id, date: '2026-10-17', text: 'Pods are **ephemeral**' });
    const points = await backlog.listPoints('k8s');
    expect(points.map((p) => [p.id, p.text])).toEqual([
      [b.id, 'Services are stable'],
      [a.id, 'Pods are **ephemeral**'],
    ]);
    await expect(backlog.edit('k8s', a.id, '   ')).rejects.toThrow(/empty/);
    await expect(backlog.edit('k8s', 'p-zzzzzzzz', 'x')).rejects.toThrow(/not found/);
  });

  it('soft-deletes with a tombstone, keeps the text, and restores', async () => {
    const a = await backlog.add('k8s', 'Pods are mortal');
    await backlog.setDeleted('k8s', a.id, true);
    expect(await readFile(dayFile(), 'utf8')).toContain('Pods are mortal');
    expect((await backlog.findPoint('k8s', a.id))?.deleted).toBe(true);
    expect(await backlog.asReadonly(async () => new Map()).listUnfiled('k8s')).toEqual([]);
    await backlog.setDeleted('k8s', a.id, false);
    expect((await backlog.findPoint('k8s', a.id))?.deleted).toBe(false);
  });

  it('finds local duplicates of live points only', async () => {
    const a = await backlog.add('k8s', 'ClusterIP services are only reachable inside the cluster');
    expect(await backlog.findDuplicate('k8s', 'clusterip services are only reachable INSIDE the cluster.')).toMatchObject({
      exact: true,
      point: { id: a.id },
    });
    await backlog.setDeleted('k8s', a.id, true);
    expect(await backlog.findDuplicate('k8s', 'ClusterIP services are only reachable inside the cluster')).toBeNull();
  });
});

const NOTE = `---
folder: k8s
subtopic: services
title: Services
updated: 2026-10-17T10:00:00.000Z
---
{{point:p-aaaaaaaa}}
`;

describe('trash', () => {
  it('lists, restores and purges a deleted folder', async () => {
    await svc.deleteFolder('k8s');
    const [item] = await trash.list();
    expect(item).toMatchObject({ kind: 'folder', title: 'K8s', folder: 'k8s' });
    await svc.createFolder('K8s'); // the slug is taken again meanwhile
    const restored = await trash.restore(item!.id);
    expect(restored.folder).toBe('k8s-2');
    expect((await svc.listFolders()).map((f) => f.slug).sort()).toEqual(['k8s', 'k8s-2']);
    expect(await trash.list()).toEqual([]);
  });

  it('trashes a note (its points become unfiled) and restores it without overwriting', async () => {
    await writeFile(join(root, 'k8s', 'notes', 'services.md'), NOTE);
    expect([...(await notes.filing('k8s')).keys()]).toEqual(['p-aaaaaaaa']);
    await notes.trash('k8s', 'services');
    expect(await notes.listSlugs('k8s')).toEqual([]);
    expect((await notes.filing('k8s')).size).toBe(0);
    const [item] = await trash.list();
    expect(item).toMatchObject({ kind: 'note', title: 'Services', folder: 'k8s' });

    await writeFile(join(root, 'k8s', 'notes', 'services.md'), NOTE.replace('Services', 'Newer'));
    await trash.restore(item!.id);
    expect(await notes.listSlugs('k8s')).toEqual(['services', 'services-2']);
    expect(await readFile(join(root, 'k8s', 'notes', 'services-2.md'), 'utf8')).toBe(NOTE);
  });

  it('refuses to restore a note whose folder is gone', async () => {
    await writeFile(join(root, 'k8s', 'notes', 'services.md'), NOTE);
    await notes.trash('k8s', 'services');
    await svc.deleteFolder('k8s');
    const note = (await trash.list()).find((i) => i.kind === 'note');
    await expect(trash.restore(note!.id)).rejects.toThrow(/Restore the folder first/);
  });

  it('purges one item or everything, and rejects IDs outside the trash', async () => {
    await writeFile(join(root, 'k8s', 'notes', 'services.md'), NOTE);
    await notes.trash('k8s', 'services');
    await svc.deleteFolder('k8s');
    const items = await trash.list();
    expect(items).toHaveLength(2);
    await trash.purge(items[0]!.id);
    expect(await trash.list()).toHaveLength(1);
    await expect(trash.purge('../../etc')).rejects.toThrow(/Not in the trash/);
    await expect(trash.restore('notes/../../x-2026-10-17T09-00-00-000Z.md')).rejects.toThrow(/Not in the trash/);
    await trash.purge();
    expect(await trash.list()).toEqual([]);
    expect(await readdir(join(root, '.lode'))).not.toContain('trash');
  });
});
