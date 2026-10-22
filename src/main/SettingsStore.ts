import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite } from '@core/fs/atomicWrite';

const VaultEntry = z.object({ id: z.string(), path: z.string(), name: z.string() });

export const LlmSettingsSchema = z.object({
  baseUrl: z.string().url().max(500).default('https://api.openai.com/v1'),
  model: z.string().max(200).default(''),
});

export const GenerationSettingsSchema = z.object({
  useSearch: z.boolean().default(true),
  unsourced: z.enum(['drop', 'mark']).default('drop'),
  batchSize: z.number().int().min(1).max(50).default(20),
  maxSearchesPerChunk: z.number().int().min(0).max(10).default(4),
  maxInputTokens: z.number().int().min(1000).max(1_000_000).default(60_000),
});

export const AppSettingsSchema = z.object({
  vaults: z.array(VaultEntry).default([]),
  lastVaultId: z.string().optional(),
  llm: LlmSettingsSchema.default(() => LlmSettingsSchema.parse({})),
  generation: GenerationSettingsSchema.default(() => GenerationSettingsSchema.parse({})),
  /** Linux without a keyring: user explicitly accepts basic (obfuscated) key storage. */
  allowWeakKeyStorage: z.boolean().default(false),
  /** Chromium zoom level (0 = 100%); Ctrl +/-/0 change it. */
  zoomLevel: z.number().min(-3).max(5).default(0),
});

export type LlmSettings = z.infer<typeof LlmSettingsSchema>;
export type GenSettings = z.infer<typeof GenerationSettingsSchema>;

export type AppSettings = z.infer<typeof AppSettingsSchema>;

/** App-level settings in userData. Never holds secrets; keys live in KeyStore. */
export class SettingsStore {
  private current: AppSettings | null = null;
  private readonly path: string;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'settings.json');
  }

  async get(): Promise<AppSettings> {
    if (this.current) return this.current;
    try {
      this.current = AppSettingsSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      this.current = AppSettingsSchema.parse({});
    }
    return this.current;
  }

  async update(fn: (s: AppSettings) => AppSettings): Promise<AppSettings> {
    const next = AppSettingsSchema.parse(fn(structuredClone(await this.get())));
    await atomicWrite(this.path, JSON.stringify(next, null, 2) + '\n');
    this.current = next;
    return next;
  }
}
