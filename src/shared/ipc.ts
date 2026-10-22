import { z } from 'zod';
import type { Point } from './types';

/**
 * IPC contract. Main validates every payload with these schemas; preload exposes
 * one named method per channel (no generic passthrough). No channel returns a key.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const vaultId = z.string().regex(/^[a-f0-9]{16}$/);
const keyId = z.enum(['llm', 'tavily']);
const pointId = z.string().regex(/^p-[0-9a-z]{8}$/);
const jobId = z.string().regex(/^j-[0-9a-f]{8,16}$/);
/** A digest period: ISO week `2026-W42` or month `2026-10`. */
const digestId = z.string().regex(/^\d{4}-(?:W(?:0[1-9]|[1-4]\d|5[0-3])|(?:0[1-9]|1[0-2]))$/);
const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** A path inside `.lode/trash/` as returned by `trash:list`; re-checked in core before any fs call. */
const trashId = z.string().max(300).regex(new RegExp(`^(?:${SLUG}-${STAMP}|notes/${SLUG}/${SLUG}-${STAMP}\\.md)$`));

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
    /** Add even though it looks like an earlier point. Exact repeats are still refused. */
    force: z.boolean().optional(),
  }),
  'backlog:edit': z.object({ vaultId, folder: slug, id: pointId, text: z.string().min(1).max(4000) }),
  'backlog:softDelete': z.object({ vaultId, folder: slug, id: pointId, deleted: z.boolean() }),
  'backlog:listDays': z.object({ vaultId, folder: slug }),
  'notes:list': z.object({ vaultId, folder: slug }),
  'notes:read': z.object({ vaultId, folder: slug, subtopic: slug }),
  'notes:rename': z.object({ vaultId, folder: slug, subtopic: slug, title: z.string().min(1).max(120) }),
  'notes:delete': z.object({ vaultId, folder: slug, subtopic: slug }),
  'notes:undoRegenerate': z.object({ vaultId, folder: slug, subtopic: slug }),
  'trash:list': z.object({ vaultId }),
  'trash:restore': z.object({ vaultId, id: trashId }),
  /** Without `id`, empties the whole trash. */
  'trash:purge': z.object({ vaultId, id: trashId.optional() }),
  'review:list': z.object({ vaultId }),
  'review:mark': z.object({
    vaultId,
    items: z
      .array(z.object({ id: pointId, stage: z.union([z.literal(1), z.literal(7), z.literal(30)]) }))
      .min(1)
      .max(1000),
  }),
  'search:query': z.object({ vaultId, q: z.string().min(1).max(200), limit: z.number().int().min(1).max(200).optional() }),
  'digest:periods': z.object({ vaultId, folder: slug }),
  'digest:list': z.object({ vaultId, folder: slug }),
  'digest:read': z.object({ vaultId, folder: slug, digest: digestId }),
  'digest:delete': z.object({ vaultId, folder: slug, digest: digestId }),
  'link:open': z.object({ url: z.string().url().max(2048) }),
  'ui:confirm': z.object({
    message: z.string().min(1).max(300),
    detail: z.string().max(1000).optional(),
    confirmLabel: z.string().min(1).max(40),
    danger: z.boolean().optional(),
  }),
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
  /** With `subtopic`, previews a Regenerate of that note instead of a Generate. */
  /** With `digest`, previews a digest for that period. */
  'generate:preview': z.object({ vaultId, folder: slug, subtopic: slug.optional(), digest: digestId.optional() }),
  'generate:enqueue': z.object({ vaultId, folder: slug, subtopic: slug.optional(), digest: digestId.optional() }),
  'generate:jobs': z.object({}),
  'generate:cancel': z.object({ jobId }),
  'generate:dismiss': z.object({ jobId }),
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

export type JobKind = 'generate' | 'regenerate' | 'digest';

export interface PreviewView {
  kind: JobKind;
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
  duplicates: string[];
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** A background Generate or Regenerate, as shown in the status bar. */
export interface JobView {
  id: string;
  vaultId: string;
  folder: string;
  folderTitle: string;
  kind: JobKind;
  subtopic?: string;
  subtopicTitle?: string;
  /** Digest jobs: the period ID and its title. */
  digest?: string;
  digestTitle?: string;
  status: JobStatus;
  progress: ProgressView | null;
  report?: RunReportView;
  error?: string;
  queuedAt: string;
  finishedAt?: string;
}

/** `backlog:add` either adds the point or reports the earlier point it repeats (nothing written). */
export type AddResult =
  | { added: Point }
  | { duplicate: { id: string; text: string; date: string; exact: boolean } };

export type ProgressView =
  | { phase: 'collecting' }
  | { phase: 'calling'; chunk: number; chunks: number; retry: boolean }
  | { phase: 'searching'; query: string }
  | { phase: 'writing'; subtopics: number }
  | { phase: 'done' };
