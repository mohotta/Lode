// Domain types shared by core, main and renderer. Pure types only: no runtime imports.

export type PointId = `p-${string}`;

export interface Point {
  id: PointId;
  /** Exactly as the user wrote it. Multi-line points keep their newlines. */
  text: string;
  /** Local date the point was added, YYYY-MM-DD. */
  date: string;
  folder: string;
  deleted: boolean;
}

export interface Source {
  title: string;
  url: string;
}

export type Block =
  | { kind: 'point'; id: PointId }
  | {
      kind: 'llm';
      id: string;
      model: string;
      at: string;
      body: string;
      /** Derived from the links in `body`. */
      sources: Source[];
      /** Set for an AI correction note about one user point (the point text itself is never changed). */
      correctionFor?: PointId;
      /** Set when the model judged point `id` to repeat the earlier point `of`. The body is fixed text. */
      duplicate?: { id: PointId; of: PointId };
    }
  /** Text that is not a Lode block (e.g. an external edit). Preserved, rendered as plain text. */
  | { kind: 'raw'; text: string };

export interface FolderInfo {
  slug: string;
  title: string;
  createdAt: string;
}

export interface VaultInfo {
  id: string;
  name: string;
  path: string;
}

export interface SubtopicInfo {
  slug: string;
  title: string;
  pointCount: number;
}

export interface PointWithFiling extends Point {
  /** Subtopic slugs whose note references this point. Empty means unfiled. */
  filedUnder: string[];
  /** True when some note carries an AI correction note for this point. */
  corrected: boolean;
  /** The earlier point this one repeats, when Generate flagged it as a duplicate. */
  duplicateOf?: PointId;
}

export interface BacklogDay {
  date: string;
  points: PointWithFiling[];
}

/** A note as the renderer sees it: point blocks resolved against the backlog in main. */
export type ResolvedBlock =
  | {
      kind: 'point';
      id: PointId;
      text: string;
      date: string;
      deleted: boolean;
      missing: boolean;
      /** A correction note for this point exists in this note. */
      corrected: boolean;
      /** Set when this point repeats an earlier one (flagged by Generate). */
      duplicateOf?: { id: PointId; date: string };
    }
  | Extract<Block, { kind: 'llm' }>
  | Extract<Block, { kind: 'raw' }>;

export interface ResolvedNote {
  folder: string;
  slug: string;
  title: string;
  updated: string;
  blocks: ResolvedBlock[];
  /** True when the last Regenerate of this note can still be undone. */
  canUndo: boolean;
}

export interface TrashItem {
  /** Path inside `.lode/trash/`, used as the item's ID. */
  id: string;
  kind: 'folder' | 'note';
  title: string;
  /** Folder slug: the folder itself, or the folder a note belonged to. */
  folder: string;
  deletedAt: string;
}
