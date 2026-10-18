import type { Point, PointId, ResolvedBlock, ResolvedNote } from '@shared/types';
import { correctedIdsIn, type NoteFile } from '../formats/note';

/** Joins note blocks with backlog text. User text comes only from the backlog, never from the note. */
export function resolveNote(folder: string, slug: string, note: NoteFile, points: readonly Point[]): ResolvedNote {
  const byId = new Map<PointId, Point>(points.map((p) => [p.id, p]));
  const corrected = new Set(correctedIdsIn(note.blocks));
  const blocks: ResolvedBlock[] = note.blocks.map((b) => {
    if (b.kind !== 'point') return b;
    const p = byId.get(b.id);
    return p
      ? { kind: 'point', id: b.id, text: p.text, date: p.date, deleted: p.deleted, missing: false, corrected: corrected.has(b.id) }
      : { kind: 'point', id: b.id, text: '', date: '', deleted: false, missing: true, corrected: false };
  });
  return { folder, slug, title: note.meta.title, updated: note.meta.updated, blocks };
}
