import { useEffect, useState } from 'react';
import type { JobView } from '@shared/ipc';
import type { DigestInfo, ResolvedNote, SubtopicInfo } from '@shared/types';
import { lode, unwrap } from '../api';
import { LlmBlock, PointBlock, RawBlock } from './Blocks';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  DotsIcon,
  HashIcon,
  DigestIcon,
  NoteIcon,
  PersonIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  UndoIcon,
} from './Icons';
import { Menu } from './Menu';

interface Props {
  vaultId: string | null;
  folder: string | null;
  folderTitle: string | null;
  subtopics: SubtopicInfo[];
  active: string | null;
  version: number;
  /** `null` shows the folder's subtopic overview. */
  onSelect(slug: string | null): void;
  onError(msg: string): void;
  onJumpToPoint(id: string): void;
  canBack: boolean;
  canForward: boolean;
  onBack(): void;
  onForward(): void;
  /** A queued or running Regenerate of the open note, if any. */
  regenJob: JobView | undefined;
  onRegenerate(slug: string, title: string): void;
  onOpenJob(jobId: string): void;
  onUndoRegenerate(slug: string): Promise<void>;
  onDelete(slug: string, title: string): void;
  onEditPoint(id: string, text: string): Promise<boolean>;
  onSetPointDeleted(id: string, deleted: boolean): Promise<void>;
  digests: DigestInfo[];
  onNewDigest(): void;
  onRegenerateDigest(id: string, title: string): void;
  onDeleteDigest(id: string, title: string): void;
}

/** Notes and digests share the pane; a digest is addressed as `digest:<period>`. */
export const DIGEST_PREFIX = 'digest:';

const MINE_ONLY_KEY = 'lode.mineOnly';

/** Per-device convenience: remembers the My points only toggle. */
function loadMineOnly(): boolean {
  try {
    return localStorage.getItem(MINE_ONLY_KEY) === '1';
  } catch {
    return false;
  }
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
  const [mineOnly, setMineOnly] = useState<boolean>(loadMineOnly);
  const toggleMineOnly = (): void => {
    const next = !mineOnly;
    setMineOnly(next);
    try {
      localStorage.setItem(MINE_ONLY_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable: the toggle just won't persist.
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!vaultId || !folder || !active) return;
    const read = active.startsWith(DIGEST_PREFIX)
      ? lode.digest.read(vaultId, folder, active.slice(DIGEST_PREFIX.length))
      : lode.notes.read(vaultId, folder, active);
    unwrap(read).then(
      (n) => !cancelled && setNote(n),
      (e: unknown) => !cancelled && onError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, folder, active, version, onError]);

  const isDigest = !!active?.startsWith(DIGEST_PREFIX);
  const activeSlug = isDigest && active ? active.slice(DIGEST_PREFIX.length) : active;
  const shown = note && activeSlug && note.slug === activeSlug && note.folder === folder ? note : null;
  const mine = shown?.blocks.filter((b) => b.kind === 'point').length ?? 0;
  const ai = shown?.blocks.filter((b) => b.kind === 'llm' && !b.duplicate).length ?? 0;

  return (
    <aside className="note-pane" aria-label="Notes">
      <div className="pane-bar">
        <div className="pane-nav">
          <button className="icon-btn" aria-label="Back" title="Back (Alt+←)" disabled={!p.canBack} onClick={p.onBack}>
            <ArrowLeftIcon size={15} />
          </button>
          <button
            className="icon-btn"
            aria-label="Forward"
            title="Forward (Alt+→)"
            disabled={!p.canForward}
            onClick={p.onForward}
          >
            <ArrowRightIcon size={15} />
          </button>
          {p.folderTitle && (
            <nav className="crumbs" aria-label="Breadcrumb">
              {shown ? (
                <button className="crumb-link" onClick={() => p.onSelect(null)} title="All subtopics in this folder">
                  {p.folderTitle}
                </button>
              ) : (
                <span className="crumb-current" aria-current="page">
                  {p.folderTitle}
                </span>
              )}
              {shown && (
                <>
                  <ChevronRightIcon size={12} />
                  <span className="crumb-current" aria-current="page">
                    {shown.title}
                  </span>
                </>
              )}
            </nav>
          )}
        </div>
        {shown && (
          <div className="note-actions">
            <button
              className={`btn toggle ${mineOnly ? 'on' : ''}`}
              aria-pressed={mineOnly}
              onClick={toggleMineOnly}
              title="Hide AI sections and show only your own points"
            >
              <PersonIcon size={14} /> My points
            </button>
            {p.regenJob ? (
              <button className="btn" onClick={() => p.regenJob && p.onOpenJob(p.regenJob.id)}>
                <span className="spinner small" aria-hidden="true" />
                {p.regenJob.status === 'queued' ? 'Queued' : isDigest ? 'Writing…' : 'Regenerating…'}
              </button>
            ) : (
              <button
                className="btn"
                onClick={() =>
                  isDigest ? p.onRegenerateDigest(shown.slug, shown.title) : p.onRegenerate(shown.slug, shown.title)
                }
                title={isDigest ? 'Write this digest again' : "Rewrite this note's AI sections from all of its points"}
              >
                <RefreshIcon size={14} /> Regenerate
              </button>
            )}
            <Menu
              label="Note actions"
              trigger={<DotsIcon size={15} />}
              align="end"
              items={isDigest ? [
                {
                  label: 'Delete digest',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  onSelect: () => p.onDeleteDigest(shown.slug, shown.title),
                },
              ] : [
                ...(shown.canUndo
                  ? [
                      {
                        label: 'Undo regenerate',
                        icon: <UndoIcon size={14} />,
                        onSelect: () => void p.onUndoRegenerate(shown.slug),
                      },
                      'separator' as const,
                    ]
                  : []),
                {
                  label: 'Move to trash',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  onSelect: () => p.onDelete(shown.slug, shown.title),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="note-scroll">
        {shown ? (
          <section className="note" aria-labelledby="note-title">
            <h2 id="note-title" className="note-title">
              {shown.title}
            </h2>
            <p className="note-meta">
              {isDigest && (
                <>
                  <DigestIcon size={12} /> Digest ·{' '}
                </>
              )}
              {mine} {mine === 1 ? 'point' : 'points'} of yours · {ai} AI {ai === 1 ? 'section' : 'sections'}
              {shown.updated && ` · updated ${relative(shown.updated)}`}
              {mineOnly && ai > 0 && ' · AI sections hidden'}
            </p>
            <div className="blocks">
              {shown.blocks.filter((b) => !mineOnly || b.kind !== 'llm').map((b, i) =>
                b.kind === 'point' ? (
                  <PointBlock
                    key={`${b.id}-${i}`}
                    block={b}
                    onJump={p.onJumpToPoint}
                    onEdit={p.onEditPoint}
                    onSetDeleted={p.onSetPointDeleted}
                  />
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
        ) : p.subtopics.length === 0 && p.digests.length === 0 ? (
          <div className="empty-state">
            <NoteIcon size={28} className="empty-icon" />
            <p className="empty-title">No notes yet</p>
            <p>Capture a few points, then press Generate to organise them into subtopics.</p>
            <button className="btn" onClick={p.onNewDigest}>
              <DigestIcon size={14} /> New digest
            </button>
          </div>
        ) : (
          <div className="overview">
            {p.subtopics.length > 0 && <h2 className="overview-title">Subtopics</h2>}
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
            <div className="overview-head">
              <h2 className="overview-title">Digests</h2>
              <button className="btn" onClick={p.onNewDigest}>
                <PlusIcon size={13} /> New digest
              </button>
            </div>
            {p.digests.length === 0 ? (
              <p className="muted small">Weekly and monthly recaps of your points appear here.</p>
            ) : (
              <ul className="cards" role="list" aria-label="Digests">
                {p.digests.map((d) => (
                  <li key={d.id}>
                    <button className="card" onClick={() => p.onSelect(`${DIGEST_PREFIX}${d.id}`)}>
                      <DigestIcon size={14} className="card-icon" />
                      <span className="card-title">{d.title}</span>
                      <span className="card-sub">
                        {d.kind === 'week' ? 'Weekly' : 'Monthly'} · {d.pointCount} {d.pointCount === 1 ? 'point' : 'points'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
