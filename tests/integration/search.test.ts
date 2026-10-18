import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchIndex, toFtsQuery } from '@core/index/SearchIndex';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import { hashBacklogs, removeDir, tempDir } from '../helpers';

describe('toFtsQuery', () => {
  it('quotes every word as a prefix term so FTS syntax cannot be injected', () => {
    expect(toFtsQuery('cluster IP')).toBe('"cluster"* AND "IP"*');
    expect(toFtsQuery('a" OR b NEAR(')).toBe('"a"* AND "OR"* AND "b"* AND "NEAR"*');
    expect(toFtsQuery('  -- ** ')).toBeNull();
  });
});

let root: string;
let vault: Vault;
let svc: VaultService;
let backlog: BacklogRepo;
let index: SearchIndex;

beforeEach(async () => {
  root = await tempDir();
  vault = new Vault(root);
  svc = new VaultService(vault);
  await svc.init();
  await svc.createFolder('Kubernetes');
  await svc.createFolder('Postgres');
  backlog = new BacklogRepo(vault, { now: () => new Date(2026, 9, 17, 9) });
  index = new SearchIndex(vault, async () => new Map((await svc.listFolders()).map((f) => [f.slug, f.title])));
});
afterEach(async () => {
  index.close();
  await removeDir(root);
});

const note = (title: string, body: string): string =>
  `---\nfolder: kubernetes\nsubtopic: svc\ntitle: ${title}\nupdated: x\n---\n${body}\n`;

describe('SearchIndex', () => {
  it('finds points and AI text apart, with highlighted snippets, and never writes the backlog', async () => {
    const p = await backlog.add('kubernetes', 'ClusterIP services are only reachable inside the cluster');
    await backlog.add('postgres', 'VACUUM reclaims dead tuples');
    await writeFile(
      join(root, 'kubernetes', 'notes', 'svc.md'),
      note(
        'Services',
        `{{point:${p.id}}}\n\n::llm{id=b-1 model="m" at="x"}\nA **Service** load-balances across \`pods\`. [Docs](https://kubernetes.io/x)\n::\n\n` +
          `::llm{id=b-2 kind=correction for=${p.id} model="m" at="x"}\nServices are also reachable via NodePort.\n::`,
      ),
    );
    const hashes = await hashBacklogs(root);

    const hits = await index.query('servic');
    expect(hits.filter((h) => h.kind === 'point')).toEqual([
      expect.objectContaining({ id: p.id, folder: 'kubernetes', folderTitle: 'Kubernetes', date: '2026-10-17', deleted: false }),
    ]);
    const ai = hits.filter((h) => h.kind === 'ai');
    expect(ai).toHaveLength(2);
    expect(ai.every((h) => h.kind === 'ai' && h.noteTitle === 'Services' && h.note === 'svc' && !h.digest)).toBe(true);
    expect(ai.some((h) => h.kind === 'ai' && h.correction)).toBe(true);
    expect(hits[0]!.snippet).toContain('\u0001');
    expect(hits.some((h) => h.snippet.includes('https://'))).toBe(false); // link URLs are not indexed
    expect(hits.some((h) => /\*\*|`/.test(h.snippet))).toBe(false); // nor markdown marks
    expect(await index.query('vacuum tuples')).toEqual([expect.objectContaining({ kind: 'point', folder: 'postgres' })]);
    expect(await hashBacklogs(root)).toEqual(hashes);
  });

  it('picks up edits, deletes and removed files incrementally, and rebuilds when the index is deleted', async () => {
    const p = await backlog.add('kubernetes', 'Pods are mortal');
    expect(await index.query('mortal')).toHaveLength(1);
    await backlog.edit('kubernetes', p.id, 'Pods are ephemeral');
    expect(await index.query('mortal')).toHaveLength(0);
    expect(await index.query('ephemeral')).toHaveLength(1);
    await backlog.setDeleted('kubernetes', p.id, true);
    expect(await index.query('ephemeral')).toEqual([expect.objectContaining({ deleted: true })]);

    // An external editor writes a new day file.
    await writeFile(join(root, 'kubernetes', 'backlog', '2026-10-10.md'), '---\ndate: 2026-10-10\ndeleted: []\n---\n- Etcd stores state ^p-abcdefgh\n');
    expect(await index.query('etcd')).toEqual([expect.objectContaining({ id: 'p-abcdefgh', date: '2026-10-10' })]);
    await rm(join(root, 'kubernetes', 'backlog', '2026-10-10.md'));
    expect(await index.query('etcd')).toEqual([]);

    index.close();
    await rm(join(root, '.lode', 'index.sqlite'));
    expect(await index.query('ephemeral')).toHaveLength(1);
  });

  it('ignores trashed folders and recovers from a corrupt index file', async () => {
    await backlog.add('postgres', 'WAL archiving');
    await svc.deleteFolder('postgres');
    expect(await index.query('archiving')).toEqual([]);
    index.close();
    await writeFile(join(root, '.lode', 'index.sqlite'), 'not a database');
    await backlog.add('kubernetes', 'Ingress routes by host');
    expect(await index.query('ingress')).toHaveLength(1);
  });
});
