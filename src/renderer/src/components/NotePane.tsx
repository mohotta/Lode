import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobView } from '@shared/ipc';
import type { ArticleInfo, BacklogDay, DigestInfo, ResolvedArticle, ResolvedNote, SubtopicInfo } from '@shared/types';
import { lode, unwrap } from '../api';
import { dayMonth } from '../dates';
import { ArticleEditor } from './ArticleEditor';
import { host, LlmBlock, PointBlock, RawBlock, type LlmB } from './Blocks';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  DotsIcon,
  GridIcon,
  ListIcon,
  NoteIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SparkIcon,
  TrashIcon,
  UndoIcon,
} from './Icons';
import { CiteContext } from './Markdown';
import { EmptyState } from './EmptyState';
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
  /** The open folder's backlog, newest first (for the folder overview). */
  days: BacklogDay[];
  /** Point ID → notes it is filed in (for "Also in"). */
  filedIn: Map<string, string[]>;
  onNewDigest(): void;
  onRegenerateDigest(id: string, title: string): void;
  onDeleteDigest(id: string, title: string): void;
  articles: ArticleInfo[];
  onNewArticle(): void;
  /** Opens the AI edit preview for a note with the user's instruction. */
  onReviseArticle(slug: string, title: string, instruction: string): void;
  onSaveArticle(slug: string, edit: Parameters<typeof lode.article.save>[3]): Promise<boolean>;
  onUndoArticle(slug: string): Promise<void>;
  onDeleteArticle(slug: string, title: string): void;
}

/** Notes and digests share the pane; a digest is addressed as `digest:<period>`. */
export const DIGEST_PREFIX = 'digest:';
/** A composed note (article) is addressed as `article:<slug>`. */
export const ARTICLE_PREFIX = 'article:';

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

/** Per-device convenience: remembers the All / Only mine choice. */
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

const monthAbbr = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();

export function NotePane(p: Props): React.JSX.Element {
  const { vaultId, folder, active, version, onError } = p;
  // Keyed by the address it was read for, since a note and a subtopic may share a slug.
  const [note, setNote] = useState<{ key: string; note: ResolvedNote | ResolvedArticle } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const onSelectRef = useRef(p.onSelect);
  useEffect(() => {
    onSelectRef.current = p.onSelect;
  });
  const [mineOnlyPref, setMineOnly] = useState<boolean>(loadMineOnly);
  const [layout, setLayout] = useState(loadLayout);
  const chooseLayout = (v: 'cards' | 'list'): void => {
    setLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  };
  const chooseMineOnly = (next: boolean): void => {
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
    const read: Promise<ResolvedNote | ResolvedArticle> = active.startsWith(DIGEST_PREFIX)
      ? unwrap(lode.digest.read(vaultId, folder, active.slice(DIGEST_PREFIX.length)))
      : active.startsWith(ARTICLE_PREFIX)
        ? unwrap(lode.article.read(vaultId, folder, active.slice(ARTICLE_PREFIX.length)))
        : unwrap(lode.notes.read(vaultId, folder, active));
    read.then(
      (n) => !cancelled && setNote({ key: active, note: n }),
      (e: unknown) => {
        if (cancelled) return;
        onError(e instanceof Error ? e.message : String(e));
        // The note is gone (deleted or renamed outside Lode): fall back to the folder overview.
        onSelectRef.current(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, folder, active, version, onError]);

  // Newest first, as the backlog lists them.
  const livePoints = p.days.flatMap((d) => d.points).filter((pt) => !pt.deleted);
  const isDigest = !!active?.startsWith(DIGEST_PREFIX);
  const isArticle = !!active?.startsWith(ARTICLE_PREFIX);
  // Notes are read whole: the All / Only mine switch applies to subtopic notes and digests only.
  const mineOnly = mineOnlyPref && !isArticle;
  const activeSlug = active ? active.slice(isDigest ? DIGEST_PREFIX.length : isArticle ? ARTICLE_PREFIX.length : 0) : active;
  const digestInfo = isDigest ? p.digests.find((d) => d.id === activeSlug) : undefined;
  const shown = note && active && note.key === active && note.note.folder === folder ? note.note : null;
  // Reads under `article:` return an article (see the effect above).
  const article = isArticle && shown ? (shown as ResolvedArticle) : null;
  const isEditing = !!article && editing === active;
  const isAsking = !!article && asking === active && !p.regenJob;
  const ai = shown?.blocks.filter((b) => b.kind === 'llm' && !b.duplicate).length ?? 0;
  const outlinePoints = (shown?.blocks ?? []).flatMap((b) =>
    b.kind === 'point' && !b.missing && !b.deleted ? [{ id: b.id, text: excerpt(b.text), date: b.date }] : [],
  );
  const sources = [
    ...new Map(
      (shown?.blocks ?? []).flatMap((b) => (b.kind === 'llm' ? b.sources.map((x) => [x.url, x] as const) : [])),
    ).values(),
  ];
  const sourceKey = sources.map((x) => x.url).join('\n');
  const cites = useMemo(() => new Map(sourceKey ? sourceKey.split('\n').map((u, i) => [u, i + 1]) : []), [sourceKey]);
  // Corrections render inside the card of the point they are about, when that point is shown.
  const shownPoints = new Set(
    (shown?.blocks ?? []).flatMap((b) => (b.kind === 'point' && !b.missing && !b.deleted && !b.duplicateOf ? [b.id] : [])),
  );
  const fixes = new Map<string, LlmB[]>();
  for (const b of shown?.blocks ?? []) {
    if (b.kind === 'llm' && b.correctionFor && shownPoints.has(b.correctionFor)) {
      fixes.set(b.correctionFor, [...(fixes.get(b.correctionFor) ?? []), b]);
    }
  }

  // Outline: the point nearest the top of the reading area is marked as the current one.
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const outlineKey = outlinePoints.map((x) => x.id).join(',');
  useEffect(() => {
    const el = scroller.current;
    if (!el || !outlineKey) return;
    const ids = outlineKey.split(',');
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const line = el.getBoundingClientRect().top + 120;
      let at = ids[0] ?? null;
      for (const id of ids) {
        const top = document.getElementById(`np-${id}`)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) at = id;
      }
      setCurrent(at);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [outlineKey, mineOnly]);

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
        {shown && !isEditing && (
          <div className="note-actions">
            {!article && (
              <div className="seg" role="group" aria-label="Show">
                {([false, true] as const).map((v) => (
                  <button
                    key={String(v)}
                    aria-pressed={mineOnly === v}
                    className={mineOnly === v ? 'on' : ''}
                    title={v ? 'Hide generated text and show only your own points' : 'Your points with generated context'}
                    onClick={() => chooseMineOnly(v)}
                  >
                    {v ? 'Only mine' : 'All'}
                  </button>
                ))}
              </div>
            )}
            {shown.updated && !isDigest && !article && (
              <span className="updated" title={new Date(shown.updated).toLocaleString()}>
                Updated {dayMonth(shown.updated)}
              </span>
            )}
            {p.regenJob && (
              <button className="btn" onClick={() => p.regenJob && p.onOpenJob(p.regenJob.id)}>
                <span className="spinner small" aria-hidden="true" />
                {p.regenJob.status === 'queued' ? 'Queued' : isDigest ? 'Writing…' : 'Rewriting…'}
              </button>
            )}
            {article && !p.regenJob && (
              <>
                <button className="btn" onClick={() => setEditing(active)} title="Edit the text yourself">
                  <PencilIcon size={13} /> Edit
                </button>
                <button
                  className={`btn ${isAsking ? 'on' : ''}`}
                  aria-expanded={isAsking}
                  onClick={() => setAsking(isAsking ? null : active)}
                  title="Tell the AI what to change"
                >
                  <SparkIcon size={13} /> Edit with AI
                </button>
              </>
            )}
            <Menu
              label="Note actions"
              trigger={<DotsIcon size={15} />}
              align="end"
              items={article ? [
                ...(article.canUndo
                  ? [
                      {
                        label: 'Undo last change',
                        icon: <UndoIcon size={14} />,
                        onSelect: () => void p.onUndoArticle(article.slug),
                      },
                      'separator' as const,
                    ]
                  : []),
                {
                  label: 'Delete note',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  onSelect: () => p.onDeleteArticle(article.slug, article.title),
                },
              ] : isDigest ? [
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

      <div className="note-scroll" ref={scroller}>
        {shown ? (
          <div className="reader">
            <section className="note" aria-labelledby="note-title">
              {isEditing && article ? (
                <>
                  <h2 id="note-title" className="visually-hidden">
                    Editing {article.title}
                  </h2>
                  <ArticleEditor
                    key={article.updated}
                    article={article}
                    onSave={(edit) => p.onSaveArticle(article.slug, edit)}
                    onCancel={() => setEditing(null)}
                  />
                </>
              ) : (
                <>
                  <h2 id="note-title" className="note-title">
                    {shown.title}
                  </h2>
                  {article && (
                    <p className="note-meta">
                      <span className="meta-strong">Note</span>
                      {article.subtopics.length > 0 &&
                        ` · from ${article.subtopics
                          .map((slug) => p.subtopics.find((x) => x.slug === slug)?.title ?? slug)
                          .join(', ')}`}
                      {article.topics.length > 0 && ` · also ${article.topics.join(', ')}`}
                      {article.updated && ` · updated ${dayMonth(article.updated)}`}
                    </p>
                  )}
                  {isAsking && article && (
                    <form
                      className="ask-bar"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const text = instruction.trim();
                        if (!text) return;
                        p.onReviseArticle(article.slug, article.title, text);
                        setAsking(null);
                        setInstruction('');
                      }}
                    >
                      <label className="visually-hidden" htmlFor="ask-input">
                        What should the AI change?
                      </label>
                      <textarea
                        id="ask-input"
                        className="text-input"
                        rows={2}
                        maxLength={2000}
                        value={instruction}
                        autoFocus
                        placeholder="What should change? e.g. “Add a section on useTransition with an example” or “Make it shorter”"
                        onChange={(e) => setInstruction(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setAsking(null);
                          } else if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                      <div className="ask-foot">
                        <span className="muted small">The AI may rewrite the whole note, then checks it for errors. You can undo.</span>
                        <button type="button" className="btn" onClick={() => setAsking(null)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn primary" disabled={!instruction.trim()}>
                          Continue
                        </button>
                      </div>
                    </form>
                  )}
                  {!article && (isDigest || (mineOnly && ai > 0)) && (
                    <p className="note-meta">
                      {isDigest && digestInfo && (
                        <>
                          <span className="meta-strong">{digestInfo.kind === 'week' ? 'Weekly digest' : 'Monthly digest'}</span>
                          {` · ${digestInfo.pointCount} ${digestInfo.pointCount === 1 ? 'point' : 'points'}`}
                        </>
                      )}
                      {isDigest && !digestInfo && <span className="meta-strong">Digest</span>}
                      {isDigest && ` · written ${dayMonth(shown.updated)}`}
                      {isDigest && mineOnly && ai > 0 && ' · '}
                      {mineOnly && ai > 0 && 'Generated sections hidden'}
                    </p>
                  )}
                  <CiteContext.Provider value={cites}>
                    <div className="blocks">
                      {shown.blocks
                        .filter((b) => !(b.kind === 'llm' && (mineOnly || (b.correctionFor && shownPoints.has(b.correctionFor)))))
                        .map((b, i) =>
                          b.kind === 'point' ? (
                            <PointBlock
                              key={`${b.id}-${i}`}
                              block={b}
                              fixes={mineOnly ? [] : fixes.get(b.id)}
                              onJump={p.onJumpToPoint}
                              onEdit={p.onEditPoint}
                              onSetDeleted={p.onSetPointDeleted}
                            />
                          ) : b.kind === 'llm' ? (
                            <LlmBlock key={`${b.id}-${i}`} block={b} label={isDigest ? 'Recap' : article ? 'AI' : 'Context'} />
                          ) : (
                            <RawBlock key={`raw-${i}`} text={b.text} />
                          ),
                        )}
                    </div>
                  </CiteContext.Provider>
                </>
              )}
            </section>
            <nav className="outline" aria-label="Outline">
              {outlinePoints.length > 0 && (
                <section className="rail-sec">
                  <h3 className="rail-head">
                    Your points <span className="mono-count">{outlinePoints.length}</span>
                  </h3>
                  <ol className="rail-list">
                    {outlinePoints.map((pt) => (
                      <li key={pt.id}>
                        <button
                          className={`rail-item point-link ${current === pt.id ? 'current' : ''}`}
                          aria-current={current === pt.id ? 'location' : undefined}
                          title={pt.text}
                          onClick={() => document.getElementById(`np-${pt.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                        >
                          <span className="rail-dot" aria-hidden="true" />
                          <span className="rail-text">
                            <span className="rail-title clamp2">{pt.text}</span>
                            <span className="rail-meta mono">{dayMonth(pt.date)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {alsoIn.length > 0 && (
                <section className="rail-sec">
                  <h3 className="rail-head">
                    Also in <span className="mono-count">{alsoIn.length}</span>
                  </h3>
                  <ul className="rail-list">
                    {alsoIn.map((x) => (
                      <li key={x.slug}>
                        <button className="rail-item" onClick={() => p.onSelect(x.slug)}>
                          <span className="rail-tile" aria-hidden="true">
                            #
                          </span>
                          <span className="rail-text">
                            <span className="rail-title one">{x.title}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {sources.length > 0 && (
                <section className="rail-sec">
                  <h3 className="rail-head">
                    Sources <span className="mono-count">{sources.length}</span>
                  </h3>
                  <ol className="rail-list source-list">
                    {sources.map((x, i) => (
                      <li key={x.url}>
                        <button className="rail-item" title={x.url} onClick={() => void lode.link.open(x.url)}>
                          <span className="rail-tile source-n" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span className="rail-text">
                            <span className="rail-title one">{x.title || host(x.url)}</span>
                            <span className="rail-meta">{host(x.url)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </nav>
          </div>
        ) : !folder ? (
          <EmptyState icon={<NoteIcon size={20} />} title="No folder open">
            Choose a folder in the sidebar. Its subtopics, digests and latest points show here.
          </EmptyState>
        ) : (
          <div className="overview">
            <div className="folder-head">
              <div>
                <h2 className="folder-title">{p.folderTitle}</h2>
                <div className="folder-stats">
                  <span>
                    <b>{p.subtopics.length}</b> {p.subtopics.length === 1 ? 'subtopic' : 'subtopics'}
                  </span>
                  <span>
                    <b>{livePoints.length}</b> {livePoints.length === 1 ? 'point' : 'points'}
                  </span>
                  {livePoints[0] && (
                    <span>
                      Last point <b>{dayMonth(livePoints[0].date)}</b>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <section className="folder-sec" aria-labelledby="h-subtopics">
              <div className="overview-head first">
                <h2 id="h-subtopics" className="overview-title">
                  Subtopics
                </h2>
                <div className="seg view-switch" role="radiogroup" aria-label="Layout">
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
                <ul className={layout === 'cards' ? 'topic-cards' : 'row-card'} role="list" aria-label="Subtopics">
                  {p.subtopics.map((s) => {
                    const latest = livePoints.find((pt) => pt.filedUnder.includes(s.slug));
                    const count = `${s.pointCount} ${s.pointCount === 1 ? 'point' : 'points'}`;
                    return (
                      <li key={s.slug}>
                        {layout === 'cards' ? (
                          <button className="topic-card" onClick={() => p.onSelect(s.slug)}>
                            <span className="topic-name">{s.title}</span>
                            {latest && <span className="topic-excerpt clamp2">{excerpt(latest.text)}</span>}
                            <span className="topic-foot">
                              <span className="topic-dots" aria-hidden="true">
                                {Array.from({ length: Math.min(s.pointCount, 5) }, (_, i) => (
                                  <span key={i} />
                                ))}
                              </span>
                              <span>{count}</span>
                              {latest && <span className="mono push">{dayMonth(latest.date)}</span>}
                            </span>
                          </button>
                        ) : (
                          <button className="topic-row-v2" onClick={() => p.onSelect(s.slug)}>
                            <span className="row-main">
                              <span className="row-title">{s.title}</span>
                              {latest && <span className="row-sub one">{excerpt(latest.text)}</span>}
                            </span>
                            <span className="topic-count">{count}</span>
                            <span className="mono topic-date">{latest ? dayMonth(latest.date) : ''}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="folder-sec" aria-labelledby="h-articles">
              <div className="overview-head first">
                <h2 id="h-articles" className="overview-title">
                  Notes
                </h2>
                <button className="btn ghost" onClick={p.onNewArticle}>
                  <PlusIcon size={13} /> New note
                </button>
              </div>
              {p.articles.length === 0 ? (
                <p className="muted small">Pick a few subtopics and the AI writes one note that ties them together. You can edit it.</p>
              ) : (
                <ul className={layout === 'cards' ? 'topic-cards' : 'row-card'} role="list" aria-label="Notes">
                  {p.articles.map((a) => {
                    const from =
                      [...a.subtopics.map((slug) => p.subtopics.find((x) => x.slug === slug)?.title ?? slug), ...a.topics].join(' · ') ||
                      'Note';
                    const count = `${a.pointCount} ${a.pointCount === 1 ? 'point' : 'points'}`;
                    const open = (): void => p.onSelect(`${ARTICLE_PREFIX}${a.slug}`);
                    return (
                      <li key={a.slug}>
                        {layout === 'cards' ? (
                          <button className="topic-card" onClick={open}>
                            <span className="topic-name">{a.title}</span>
                            <span className="topic-excerpt clamp2">{from}</span>
                            <span className="topic-foot">
                              <NoteIcon size={13} />
                              <span>{count}</span>
                              {a.updated && <span className="mono push">{dayMonth(a.updated)}</span>}
                            </span>
                          </button>
                        ) : (
                          <button className="topic-row-v2" onClick={open}>
                            <span className="row-main">
                              <span className="row-title">{a.title}</span>
                              <span className="row-sub one">{from}</span>
                            </span>
                            <span className="topic-count">{count}</span>
                            <span className="mono topic-date">{a.updated ? dayMonth(a.updated) : ''}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="folder-cols">
              <section className="folder-sec" aria-labelledby="h-digests">
                <div className="overview-head first">
                  <h2 id="h-digests" className="overview-title">
                    Digests
                  </h2>
                  <button className="btn ghost" onClick={p.onNewDigest}>
                    <PlusIcon size={13} /> New digest
                  </button>
                </div>
                {p.digests.length === 0 ? (
                  <p className="muted small">Weekly and monthly recaps of your points appear here.</p>
                ) : (
                  <ul className="digest-list" role="list" aria-label="Digests">
                    {p.digests.map((d) => (
                      <li key={d.id}>
                        <button className="digest-row" onClick={() => p.onSelect(`${DIGEST_PREFIX}${d.id}`)}>
                          <span className="cal-tile" aria-hidden="true">
                            <span className="cal-tile-top">{monthAbbr(d.from)}</span>
                            <span className="cal-tile-num">{d.kind === 'week' ? `W${d.id.split('-W')[1] ?? ''}` : `’${d.from.slice(2, 4)}`}</span>
                          </span>
                          <span className="row-main">
                            <span className="row-title">{d.title}</span>
                            <span className="row-sub">
                              {d.kind === 'week' ? 'Weekly' : 'Monthly'} · {d.pointCount} {d.pointCount === 1 ? 'point' : 'points'}
                            </span>
                          </span>
                          <ChevronRightIcon size={14} className="muted" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="folder-sec" aria-labelledby="h-latest">
                <div className="overview-head first">
                  <h2 id="h-latest" className="overview-title">
                    Latest points
                  </h2>
                </div>
                {livePoints.length === 0 ? (
                  <p className="muted small">Nothing captured yet.</p>
                ) : (
                  <ol className="latest-list">
                    {livePoints.slice(0, 6).map((pt) => (
                      <li key={pt.id}>
                        <time className="mono" dateTime={pt.date}>
                          {dayMonth(pt.date)}
                        </time>
                        <button className="latest-link clamp2" onClick={() => p.onJumpToPoint(pt.id)}>
                          {excerpt(pt.text)}
                          {pt.corrected && <span className="latest-fix">needs a fix</span>}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
