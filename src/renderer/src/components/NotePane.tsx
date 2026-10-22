import { useEffect, useState } from 'react';
import type { JobView } from '@shared/ipc';
import type { DigestInfo, ResolvedNote, SubtopicInfo } from '@shared/types';
import { lode, unwrap } from '../api';
import { dayMonth } from '../dates';
import { host, LlmBlock, PointBlock, RawBlock } from './Blocks';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  DotsIcon,
  DigestIcon,
  GridIcon,
  HashIcon,
  ListIcon,
  NoteIcon,
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
  /** Point ID → notes it is filed in (for "Also in"). */
  filedIn: Map<string, string[]>;
  onNewDigest(): void;
  onRegenerateDigest(id: string, title: string): void;
  onDeleteDigest(id: string, title: string): void;
}

/** Notes and digests share the pane; a digest is addressed as `digest:<period>`. */
export const DIGEST_PREFIX = 'digest:';

const MINE_ONLY_KEY = 'lode.mineOnly';
const LAYOUT_KEY = 'lode.overviewLayout';

/** Per-device convenience: cards or list for the folder overview. */
function loadLayout(): 'cards' | 'list' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

/** Per-device convenience: remembers the My points only toggle. */
function loadMineOnly(): boolean {
  try {
    return localStorage.getItem(MINE_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

/** First line of a point as plain text, for the outline. */
function excerpt(md: string): string {
  const line = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[`*_>#[\]]/g, '').replace(/\(https?:[^)]*\)/g, '').trim())
    .find(Boolean);
  return line ?? 'Code';
}

export function NotePane(p: Props): React.JSX.Element {
  const { vaultId, folder, active, version, onError } = p;
  const [note, setNote] = useState<ResolvedNote | null>(null);
  const [mineOnly, setMineOnly] = useState<boolean>(loadMineOnly);
  const [layout, setLayout] = useState(loadLayout);
  const chooseLayout = (v: 'cards' | 'list'): void => {
    setLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  };
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
  const ai = shown?.blocks.filter((b) => b.kind === 'llm' && !b.duplicate).length ?? 0;
  const outlinePoints = (shown?.blocks ?? []).flatMap((b) =>
    b.kind === 'point' && !b.missing && !b.deleted ? [{ id: b.id, text: excerpt(b.text) }] : [],
  );
  const sources = [
    ...new Map(
      (shown?.blocks ?? []).flatMap((b) => (b.kind === 'llm' ? b.sources.map((x) => [x.url, x] as const) : [])),
    ).values(),
  ];
  const alsoIn = isDigest
    ? []
    : [...new Set(outlinePoints.flatMap((pt) => p.filedIn.get(pt.id) ?? []))]
        .filter((slug) => slug !== activeSlug)
        .flatMap((slug) => p.subtopics.filter((x) => x.slug === slug));

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
            {shown.updated && !isDigest && (
              <span className="updated" title={new Date(shown.updated).toLocaleString()}>
                Updated {dayMonth(shown.updated)}
              </span>
            )}
            <button
              className={`btn toggle ${mineOnly ? 'on' : ''}`}
              aria-pressed={mineOnly}
              onClick={toggleMineOnly}
              title="Hide generated sections and show only your own points"
            >
              My points
            </button>
            {p.regenJob && (
              <button className="btn" onClick={() => p.regenJob && p.onOpenJob(p.regenJob.id)}>
                <span className="spinner small" aria-hidden="true" />
                {p.regenJob.status === 'queued' ? 'Queued' : isDigest ? 'Writing…' : 'Rewriting…'}
              </button>
            )}
            <Menu
              label="Note actions"
              trigger={<DotsIcon size={15} />}
              align="end"
              items={isDigest ? [
                ...(p.regenJob
                  ? []
                  : [
                      {
                        label: 'Write again',
                        icon: <RefreshIcon size={14} />,
                        onSelect: () => p.onRegenerateDigest(shown.slug, shown.title),
                      },
                      'separator' as const,
                    ]),
                {
                  label: 'Delete digest',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  onSelect: () => p.onDeleteDigest(shown.slug, shown.title),
                },
              ] : [
                ...(p.regenJob
                  ? []
                  : [
                      {
                        label: 'Rewrite from points…',
                        icon: <RefreshIcon size={14} />,
                        onSelect: () => p.onRegenerate(shown.slug, shown.title),
                      },
                    ]),
                ...(shown.canUndo
                  ? [
                      {
                        label: 'Undo rewrite',
                        icon: <UndoIcon size={14} />,
                        onSelect: () => void p.onUndoRegenerate(shown.slug),
                      },
                    ]
                  : []),
                'separator' as const,
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
          <div className="reader">
            <section className="note" aria-labelledby="note-title">
              <h2 id="note-title" className="note-title">
                {shown.title}
              </h2>
              {(isDigest || (mineOnly && ai > 0)) && (
                <p className="note-meta">
                  {isDigest && `Digest · written ${dayMonth(shown.updated)}`}
                  {isDigest && mineOnly && ai > 0 && ' · '}
                  {mineOnly && ai > 0 && 'Generated sections hidden'}
                </p>
              )}
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
            <nav className="outline" aria-label="Outline">
              {outlinePoints.length > 0 && (
                <>
                  <h3 className="outline-head">Your points</h3>
                  <ul role="list">
                    {outlinePoints.map((pt) => (
                      <li key={pt.id}>
                        <button
                          className="outline-link"
                          title={pt.text}
                          onClick={() => document.getElementById(`np-${pt.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                        >
                          {pt.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {alsoIn.length > 0 && (
                <>
                  <h3 className="outline-head">Also in</h3>
                  <ul role="list">
                    {alsoIn.map((x) => (
                      <li key={x.slug}>
                        <button className="outline-link topic-link" onClick={() => p.onSelect(x.slug)}>
                          {x.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {sources.length > 0 && (
                <>
                  <h3 className="outline-head">Sources</h3>
                  <ul role="list">
                    {sources.map((x) => (
                      <li key={x.url}>
                        <button className="outline-link" title={x.url} onClick={() => void lode.link.open(x.url)}>
                          {x.title || host(x.url)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </nav>
          </div>
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
            <div className="overview-head first">
              <h2 className="overview-title">Subtopics</h2>
              <div className="view-switch" role="radiogroup" aria-label="Layout">
                {(['cards', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={layout === v}
                    aria-label={v === 'cards' ? 'Cards' : 'List'}
                    title={v === 'cards' ? 'Cards' : 'List'}
                    className={layout === v ? 'on' : ''}
                    onClick={() => chooseLayout(v)}
                  >
                    {v === 'cards' ? <GridIcon size={14} /> : <ListIcon size={14} />}
                  </button>
                ))}
              </div>
            </div>
            {p.subtopics.length === 0 ? (
              <p className="muted small">Press Generate to organise your points into subtopics.</p>
            ) : (
              <ul className={layout === 'cards' ? 'cards' : 'topic-list'} role="list" aria-label="Subtopics">
                {p.subtopics.map((s) => (
                  <li key={s.slug}>
                    <button className={layout === 'cards' ? 'card' : 'topic-row'} onClick={() => p.onSelect(s.slug)}>
                      {layout === 'cards' && <HashIcon size={14} className="card-icon" />}
                      <span className="topic-name">{s.title}</span>
                      <span className="topic-sub">
                        {s.pointCount} {s.pointCount === 1 ? 'point' : 'points'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="overview-head">
              <h2 className="overview-title">Digests</h2>
              <button className="btn" onClick={p.onNewDigest}>
                <PlusIcon size={13} /> New digest
              </button>
            </div>
            {p.digests.length === 0 ? (
              <p className="muted small">Weekly and monthly recaps of your points appear here.</p>
            ) : (
              <ul className={layout === 'cards' ? 'cards' : 'topic-list'} role="list" aria-label="Digests">
                {p.digests.map((d) => (
                  <li key={d.id}>
                    <button
                      className={layout === 'cards' ? 'card' : 'topic-row'}
                      onClick={() => p.onSelect(`${DIGEST_PREFIX}${d.id}`)}
                    >
                      {layout === 'cards' && <DigestIcon size={14} className="card-icon" />}
                      <span className="topic-name">{d.title}</span>
                      <span className="topic-sub">
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
