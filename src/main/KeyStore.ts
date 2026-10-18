import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';
import { atomicWrite } from '@core/fs/atomicWrite';

export const KEY_IDS = ['llm', 'tavily'] as const;
export type KeyId = (typeof KEY_IDS)[number];

const KeyFile = z.record(z.string(), z.string());

/**
 * API keys encrypted with Electron safeStorage (OS keychain) in userData/keys.json.
 * Main process only. There is no IPC that returns a key (invariant 4), and keys are never logged.
 */
export class KeyStore {
  private readonly path: string;

  constructor(
    userDataDir: string,
    /** User opt-in (Settings) to store keys when Linux has no keyring and only basic obfuscation exists. */
    private readonly allowWeak: () => Promise<boolean>,
  ) {
    this.path = join(userDataDir, 'keys.json');
  }

  private async ready(): Promise<void> {
    if (process.platform === 'linux' && this.backend() === 'basic_text' && (await this.allowWeak())) {
      safeStorage.setUsePlainTextEncryption(true);
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        this.backend() === 'basic_text'
          ? 'No system keyring is available. Unlock or install one, or allow basic key storage in Settings.'
          : 'Secure storage is not available on this system',
      );
    }
  }

  /** 'basic_text' on Linux means no keyring was found and encryption is only obfuscation. */
  backend(): string {
    if (process.platform !== 'linux') return safeStorage.isEncryptionAvailable() ? 'os' : 'unavailable';
    try {
      return safeStorage.getSelectedStorageBackend();
    } catch {
      return 'unknown';
    }
  }

  private async read(): Promise<Record<string, string>> {
    try {
      return KeyFile.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      return {};
    }
  }

  async set(id: KeyId, key: string): Promise<void> {
    await this.ready();
    const clean = key.trim();
    if (!clean) throw new Error('Key cannot be empty');
    const all = await this.read();
    all[id] = safeStorage.encryptString(clean).toString('base64');
    await atomicWrite(this.path, JSON.stringify(all, null, 2) + '\n');
  }

  async has(id: KeyId): Promise<boolean> {
    return (await this.read())[id] !== undefined;
  }

  async clear(id: KeyId): Promise<void> {
    const all = await this.read();
    delete all[id];
    await atomicWrite(this.path, JSON.stringify(all, null, 2) + '\n');
  }

  /** Decrypts at call time for an outgoing provider request. Never send the result over IPC. */
  async get(id: KeyId): Promise<string> {
    const enc = (await this.read())[id];
    if (!enc) return '';
    await this.ready();
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      throw new Error(`Stored ${id === 'llm' ? 'LLM' : 'Tavily'} key could not be decrypted; please enter it again`);
    }
  }
}
