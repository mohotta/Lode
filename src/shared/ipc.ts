import { z } from 'zod';

/**
 * IPC contract. Main validates every payload with these schemas; preload exposes
 * one named method per channel (no generic passthrough). No channel returns a key.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const vaultId = z.string().regex(/^[a-f0-9]{16}$/);
const keyId = z.enum(['llm', 'tavily']);

export const Schemas = {
  'vault:list': z.object({}),
  'vault:open': z.object({}),
  'vault:forget': z.object({ vaultId }),
  'folder:list': z.object({ vaultId }),
  'folder:create': z.object({ vaultId, title: z.string().min(1).max(200) }),
  'folder:rename': z.object({ vaultId, folder: slug, title: z.string().min(1).max(200) }),
  'folder:delete': z.object({ vaultId, folder: slug }),
  'backlog:add': z.object({
    vaultId,
    folder: slug,
    text: z.string().min(1).max(4000),
    /** Optional local day (YYYY-MM-DD) to file the point under; defaults to today. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  'backlog:listDays': z.object({ vaultId, folder: slug }),
  'notes:list': z.object({ vaultId, folder: slug }),
  'notes:read': z.object({ vaultId, folder: slug, subtopic: slug }),
  'notes:rename': z.object({ vaultId, folder: slug, subtopic: slug, title: z.string().min(1).max(120) }),
  'link:open': z.object({ url: z.string().url().max(2048) }),
  'settings:get': z.object({}),
  'settings:set': z.object({
    allowWeakKeyStorage: z.boolean().optional(),
    llm: z.object({ baseUrl: z.string().url().max(500), model: z.string().max(200) }).partial().optional(),
    generation: z
      .object({
        useSearch: z.boolean(),
        unsourced: z.enum(['drop', 'mark']),
        batchSize: z.number().int().min(1).max(50),
        maxSearchesPerChunk: z.number().int().min(0).max(10),
        maxInputTokens: z.number().int().min(1000).max(1_000_000),
      })
      .partial()
      .optional(),
  }),
  'keys:set': z.object({ id: keyId, key: z.string().min(1).max(500) }),
  'keys:has': z.object({ id: keyId }),
  'keys:test': z.object({ id: keyId }),
  'keys:clear': z.object({ id: keyId }),
  'generate:preview': z.object({ vaultId, folder: slug }),
  'generate:run': z.object({ vaultId, folder: slug }),
  'generate:cancel': z.object({ vaultId, folder: slug }),
} as const;

export type Channel = keyof typeof Schemas;
export type Input<C extends Channel> = z.infer<(typeof Schemas)[C]>;

export type KeyIdName = 'llm' | 'tavily';

export interface SettingsView {
  llm: { baseUrl: string; model: string };
  generation: {
    useSearch: boolean;
    unsourced: 'drop' | 'mark';
    batchSize: number;
    maxSearchesPerChunk: number;
    maxInputTokens: number;
  };
  keys: Record<KeyIdName, boolean>;
  /** safeStorage backend; 'basic_text' means keys are not protected by a keyring. */
  keyBackend: string;
  allowWeakKeyStorage: boolean;
}

export interface PreviewView {
  points: number;
  chunks: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  useSearch: boolean;
  /** Search is enabled in Settings but no Tavily key is stored, so this run would go without it. */
  searchUnavailable: boolean;
  overCap: boolean;
  maxInputTokens: number;
  provider: string;
  model: string;
  baseUrl: string;
  /** Null when ready; otherwise why Generate is disabled. */
  blocker: string | null;
}

export interface RunReportView {
  changed: { slug: string; title: string; isNew: boolean }[];
  filed: string[];
  unfiled: string[];
  warnings: string[];
  usage: { inputTokens: number; outputTokens: number; searches: number };
  sources: number;
  corrected: string[];
}

export type ProgressView =
  | { phase: 'collecting' }
  | { phase: 'calling'; chunk: number; chunks: number; retry: boolean }
  | { phase: 'searching'; query: string }
  | { phase: 'writing'; subtopics: number }
  | { phase: 'done' };
