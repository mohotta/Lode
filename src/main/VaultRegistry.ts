import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { VaultInfo } from '@shared/types';
import { BacklogRepo } from '@core/repos/BacklogRepo';
import { NoteRepo } from '@core/repos/NoteRepo';
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
    };
    this.open.set(id, opened);
    await this.settings.update((s) => ({ ...s, lastVaultId: id }));
    return opened;
  }
}
