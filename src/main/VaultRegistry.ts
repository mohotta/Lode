import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { VaultInfo } from '@shared/types';
import { SearchIndex } from '@core/index/SearchIndex';
import { ArticleRepo } from '@core/repos/ArticleRepo';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { DigestRepo } from '@core/repos/DigestRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
import { ReviewRepo } from '@core/repos/ReviewRepo';
import { TrashRepo } from '@core/repos/TrashRepo';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import type { SettingsStore } from './SettingsStore';

export interface OpenVault {
  info: VaultInfo;
  vault: Vault;
  service: VaultService;
  backlog: BacklogRepo;
  notes: NoteRepo;
  trash: TrashRepo;
  review: ReviewRepo;
  index: SearchIndex;
  digests: DigestRepo;
  articles: ArticleRepo;
}

export function vaultIdFor(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 16);
}

/** Known vaults. The renderer refers to vaults by ID only and never supplies a path. */
export class VaultRegistry {
  private readonly open = new Map<string, OpenVault>();

  constructor(private readonly settings: SettingsStore) {}

  async list(): Promise<VaultInfo[]> {
    return (await this.settings.get()).vaults;
  }

  /** Known vaults, each checked on disk (read-only: a missing folder is reported, never created). */
  async listWithStatus(): Promise<VaultInfo[]> {
    const isDir = (p: string): Promise<boolean> => stat(p).then((s) => s.isDirectory(), () => false);
    return Promise.all((await this.list()).map(async (v) => ({ ...v, missing: !(await isDir(v.path)) })));
  }

  /**
   * User-initiated only (`vault:recreate`, after the app showed the folder as missing): creates the
   * vault folder again, empty, at its recorded path. Refused if something is already there.
   */
  async recreate(id: string): Promise<VaultInfo> {
    const info = (await this.list()).find((v) => v.id === id);
    if (!info) throw new Error('Unknown vault');
    const there = await stat(info.path).then(() => true, () => false);
    if (there) throw new Error(`"${info.path}" already exists. Open it instead.`);
    await mkdir(info.path, { recursive: true });
    this.open.get(id)?.index.close();
    this.open.delete(id);
    await new VaultService(new Vault(info.path)).init();
    return info;
  }

  async lastVaultId(): Promise<string | null> {
    return (await this.settings.get()).lastVaultId ?? null;
  }

  async add(path: string): Promise<VaultInfo> {
    const abs = resolve(path);
    const id = vaultIdFor(abs);
    const vault = new Vault(abs);
    const service = new VaultService(vault);
    await service.init();
    const info: VaultInfo = { id, path: abs, name: service.name() };
    await this.settings.update((s) => ({
      ...s,
      vaults: [...s.vaults.filter((v) => v.id !== id), info],
      lastVaultId: id,
    }));
    return info;
  }

  async forget(id: string): Promise<void> {
    this.open.get(id)?.index.close();
    this.open.delete(id);
    await this.settings.update((s) => ({
      ...s,
      vaults: s.vaults.filter((v) => v.id !== id),
      lastVaultId: s.lastVaultId === id ? undefined : s.lastVaultId,
    }));
  }

  async get(id: string): Promise<OpenVault> {
    const cached = this.open.get(id);
    if (cached) return cached;
    const info = (await this.list()).find((v) => v.id === id);
    if (!info) throw new Error('Unknown vault');
    const vault = new Vault(info.path);
    const service = new VaultService(vault);
    await service.init();
    const opened: OpenVault = {
      info,
      vault,
      service,
      backlog: new BacklogRepo(vault),
      notes: new NoteRepo(vault),
      trash: new TrashRepo(vault),
      review: new ReviewRepo(vault),
      digests: new DigestRepo(vault),
      articles: new ArticleRepo(vault),
      index: new SearchIndex(vault, async () => new Map((await service.listFolders()).map((f) => [f.slug, f.title]))),
    };
    this.open.set(id, opened);
    await this.settings.update((s) => ({ ...s, lastVaultId: id }));
    return opened;
  }
}
