import { useEffect, useState } from 'react';
import type { ResolvedNote, SubtopicInfo } from '@shared/types';
import { lode, unwrap } from '../api';
import { LlmBlock, PointBlock, RawBlock } from './Blocks';
import { ChevronRightIcon, HashIcon, NoteIcon } from './Icons';

interface Props {
  vaultId: string | null;
  folder: string | null;
  folderTitle: string | null;
  subtopics: SubtopicInfo[];
  active: string | null;
  version: number;
  onSelect(slug: string): void;
  onError(msg: string): void;
  onJumpToPoint(id: string): void;
}

function relative(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function NotePane(p: Props): React.JSX.Element {
  const { vaultId, folder, active, version, onError } = p;
  const [note, setNote] = useState<ResolvedNote | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!vaultId || !folder || !active) return;
    unwrap(lode.notes.read(vaultId, folder, active)).then(
      (n) => !cancelled && setNote(n),
      (e: unknown) => !cancelled && onError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, folder, active, version, onError]);

  const shown = note && active && note.slug === active && note.folder === folder ? note : null;
  const mine = shown?.blocks.filter((b) => b.kind === 'point').length ?? 0;
  const ai = shown?.blocks.filter((b) => b.kind === 'llm').length ?? 0;

  return (
    <aside className="note-pane" aria-label="Notes">
      <div className="pane-bar">
        {p.folderTitle && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>{p.folderTitle}</span>
            {shown && (
              <>
                <ChevronRightIcon size={12} />
                <span className="crumb-current">{shown.title}</span>
              </>
            )}
          </nav>
        )}
      </div>

      <div className="note-scroll">
        {shown ? (
          <section className="note" aria-labelledby="note-title">
            <h2 id="note-title" className="note-title">
              {shown.title}
            </h2>
            <p className="note-meta">
              {mine} {mine === 1 ? 'point' : 'points'} of yours · {ai} AI {ai === 1 ? 'section' : 'sections'}
              {shown.updated && ` · updated ${relative(shown.updated)}`}
            </p>
            <div className="blocks">
              {shown.blocks.map((b, i) =>
                b.kind === 'point' ? (
                  <PointBlock key={`${b.id}-${i}`} block={b} onJump={p.onJumpToPoint} />
                ) : b.kind === 'llm' ? (
                  <LlmBlock key={`${b.id}-${i}`} block={b} />
                ) : (
                  <RawBlock key={`raw-${i}`} text={b.text} />
                ),
              )}
            </div>
          </section>
        ) : !folder ? (
          <div className="empty-state">
            <NoteIcon size={28} className="empty-icon" />
            <p className="empty-title">No folder selected</p>
            <p>Notes for a folder appear here.</p>
          </div>
        ) : p.subtopics.length === 0 ? (
          <div className="empty-state">
            <NoteIcon size={28} className="empty-icon" />
            <p className="empty-title">No notes yet</p>
            <p>Capture a few points, then press Generate to organise them into subtopics.</p>
          </div>
        ) : (
          <div className="overview">
            <h2 className="overview-title">Subtopics</h2>
            <ul className="cards" role="list">
              {p.subtopics.map((s) => (
                <li key={s.slug}>
                  <button className="card" onClick={() => p.onSelect(s.slug)}>
                    <HashIcon size={14} className="card-icon" />
                    <span className="card-title">{s.title}</span>
                    <span className="card-sub">
                      {s.pointCount} {s.pointCount === 1 ? 'point' : 'points'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
