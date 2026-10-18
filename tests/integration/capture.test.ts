import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import { removeDir, tempDir } from '../helpers';

let root: string;
let vault: Vault;
let svc: VaultService;
let now = new Date(2026, 9, 17, 9, 0, 0);

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  svc = new VaultService(vault, () => now);
  await svc.init();
  now = new Date(2026, 9, 17, 9, 0, 0);
});
afterEach(async () => {
  await removeDir(root);
});

describe('vaults and folders', () => {
  it('initialises config and creates slugged folders', async () => {
    const f = await svc.createFolder('Kubernetes Networking');
    expect(f.slug).toBe('kubernetes-networking');
    expect((await readdir(join(root, f.slug))).sort()).toEqual(['backlog', 'folder.json', 'notes']);
    const again = await svc.createFolder('Kubernetes  networking');
    expect(again.slug).toBe('kubernetes-networking-2');
    expect((await svc.listFolders()).map((x) => x.slug).sort()).toEqual(['kubernetes-networking', 'kubernetes-networking-2']);
    await svc.init(); // idempotent
  });

  it('renames the title but keeps the slug', async () => {
    const f = await svc.createFolder('PG');
    const r = await svc.renameFolder(f.slug, 'PostgreSQL');
    expect(r).toMatchObject({ slug: 'pg', title: 'PostgreSQL' });
  });

  it('deletes into trash, keeping the data', async () => {
    const f = await svc.createFolder('Temp');
    await svc.deleteFolder(f.slug);
    expect(await svc.listFolders()).toEqual([]);
    expect((await readdir(join(root, '.lode', 'trash')))[0]).toMatch(/^temp-/);
  });

  it('rejects unsafe folder slugs', async () => {
    const repo = new BacklogRepo(vault);
    await expect(repo.add('../evil', 'x')).rejects.toThrow(/Invalid folder/);
    await expect(svc.renameFolder('..', 'x')).rejects.toThrow(/Invalid folder/);
  });
});

describe('backlog capture', () => {
  it('adds points to today\'s file with unique IDs', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    const a = await repo.add(f.slug, 'ClusterIP is internal only');
    const b = await repo.add(f.slug, 'IPVS scales better');
    expect(a.id).not.toBe(b.id);
    expect(a.date).toBe('2026-10-17');
    const file = await readFile(join(root, f.slug, 'backlog', '2026-10-17.md'), 'utf8');
    expect(file).toBe(
      `---\ndate: 2026-10-17\ndeleted: []\n---\n- ClusterIP is internal only ^${a.id}\n- IPVS scales better ^${b.id}\n`,
    );
  });

  it('lists days newest first with filing status', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    const notes = new NoteRepo(vault);
    const a = await repo.add(f.slug, 'day one');
    now = new Date(2026, 9, 18, 9, 0, 0);
    const b = await repo.add(f.slug, 'day two');
    await notes.append(f.slug, 'networking', 'Networking', [{ kind: 'point', id: a.id }], 'now');
    const days = await repo.listDays(f.slug, await notes.filing(f.slug));
    expect(days.map((d) => d.date)).toEqual(['2026-10-18', '2026-10-17']);
    expect(days[0]?.points[0]).toMatchObject({ id: b.id, filedUnder: [] });
    expect(days[1]?.points[0]).toMatchObject({ id: a.id, filedUnder: ['networking'] });
  });

  it('picks up external edits to a day file', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    await repo.add(f.slug, 'one');
    const path = join(root, f.slug, 'backlog', '2026-10-17.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '- added in vim ^p-vimvimvi\n');
    expect((await repo.listPoints(f.slug)).map((p) => p.text)).toEqual(['added in vim', 'one']);
  });

  it('serialises concurrent adds without losing points', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.add(f.slug, `point ${i}`)));
    const points = await repo.listPoints(f.slug);
    expect(points).toHaveLength(20);
    expect(new Set(points.map((p) => p.id)).size).toBe(20);
  });

  it('adds a point to an earlier day, appending to that day\'s existing file', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    now = new Date(2026, 9, 14, 9);
    const old = await repo.add(f.slug, 'from the 14th');
    const path = join(root, f.slug, 'backlog', '2026-10-14.md');
    const before = await readFile(path, 'utf8');
    now = new Date(2026, 9, 17, 9);
    const back = await repo.add(f.slug, 'backfilled', '2026-10-14');
    expect(back.date).toBe('2026-10-14');
    const after = await readFile(path, 'utf8');
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain(`- backfilled ^${back.id}`);
    const days = await repo.listDays(f.slug, new Map());
    expect(days.map((d) => d.date)).toEqual(['2026-10-14']);
    expect(days[0]?.points.map((p) => p.id)).toEqual([back.id, old.id]);
  });

  it('creates the day file for a past date with no points yet', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    await repo.add(f.slug, 'a while ago', '2025-01-31');
    expect(await readFile(join(root, f.slug, 'backlog', '2025-01-31.md'), 'utf8')).toMatch(/^---\ndate: 2025-01-31\n/);
  });

  it('rejects future, malformed and impossible dates without writing', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    await expect(repo.add(f.slug, 'x', '2026-10-18')).rejects.toThrow(/today or an earlier day/);
    await expect(repo.add(f.slug, 'x', '2026-02-30')).rejects.toThrow(/valid date/);
    await expect(repo.add(f.slug, 'x', '../../etc')).rejects.toThrow(/valid date/);
    expect(await readdir(join(root, f.slug, 'backlog'))).toEqual([]);
  });

  it('read-only view lists unfiled points oldest first, frozen, and has no write methods', async () => {
    const f = await svc.createFolder('K8s');
    const repo = new BacklogRepo(vault, { now: () => now });
    const notes = new NoteRepo(vault);
    const a = await repo.add(f.slug, 'a');
    const b = await repo.add(f.slug, 'b');
    const c = await repo.add(f.slug, 'c');
    await notes.append(f.slug, 'x', 'X', [{ kind: 'point', id: b.id }], 'now');
    const ro = repo.asReadonly((folder) => notes.filing(folder));
    const unfiled = await ro.listUnfiled(f.slug);
    expect(unfiled.map((p) => p.id)).toEqual([a.id, c.id]);
    expect(Object.isFrozen(unfiled)).toBe(true);
    expect(Object.isFrozen(unfiled[0])).toBe(true);
    expect(Object.keys(ro).sort()).toEqual(['get', 'listUnfiled']);
    expect((await ro.get(c.id))?.text).toBe('c');
    expect(await ro.get('p-nonexist')).toBeUndefined();
  });
});
