import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '@shared/types';
import { lode, unwrap } from '../api';
import { shortDate } from '../dates';
import { ListIcon, SearchIcon, SparkIcon } from './Icons';

interface Props {
  vaultId: string;
  query: string;
  onQuery(q: string): void;
  onOpenPoint(folder: string, id: string): void;
  onOpenNote(folder: string, note: string, digest: boolean): void;
  onClose(): void;
}

type Filter = 'all' | 'mine' | 'ai';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['ai', 'Generated'],
];

/** Renders an FTS snippet: U+0001/U+0002 delimit matches. Plain text only, never markup. */
function Snippet({ text }: { text: string }): React.JSX.Element {
  // eslint-disable-next-line no-control-regex
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <span className="snippet">
      {parts.map((part, i) =>
        part.startsWith('\u0001') ? <mark key={i}>{part.slice(1, -1)}</mark> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

// eslint-disable-next-line no-control-regex
const plain = (snippet: string): string => snippet.replace(/[\u0001\u0002]/g, '');

/** A short title for a point: its first sentence or line of the snippet. */
function pointTitle(snippet: string): string {
  const first = plain(snippet).split(/(?<=[.!?:])\s|\n/)[0]?.trim() ?? '';
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || 'Your point';
}

/**
 * FR-28: one search over the backlog and notes, as a Ctrl+K overlay. Your points and AI text are
 * listed apart, with a preview of the highlighted result. ↑↓ move, Enter opens, Tab switches the filter.
 */
export function SearchView({ vaultId, query, onQuery, onOpenPoint, onOpenNote, onClose }: Props): React.JSX.Element {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // Escape closes the overlay only (capture phase, marked handled), not the page beneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (!q) {
        setHits(null);
        return;
      }
      unwrap(lode.search.query(vaultId, q, 80)).then(
        (h) => {
          if (cancelled) return;
          setHits(h);
          setSel(0);
          setError(null);
        },
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vaultId, query]);

  const mine = filter === 'ai' ? [] : (hits?.filter((h) => h.kind === 'point') ?? []);
  const ai = filter === 'mine' ? [] : (hits?.filter((h) => h.kind === 'ai') ?? []);
  const flat = [...mine, ...ai];
  const active = flat[Math.min(sel, flat.length - 1)];

  const open = (h: SearchHit): void => {
    if (h.kind === 'point') onOpenPoint(h.folder, h.id);
    else onOpenNote(h.folder, h.note, h.digest);
  };

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      open(active);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const i = FILTERS.findIndex(([f]) => f === filter);
      setFilter(FILTERS[(i + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]![0]);
      setSel(0);
    }
  };

  const row = (h: SearchHit, i: number): React.JSX.Element => {
    const mineHit = h.kind === 'point';
    return (
      <li key={mineHit ? h.id : `${h.folder}-${h.note}-${i}`}>
        <button
          className={`search-hit ${mineHit ? 'mine' : 'ai'} ${mineHit && h.deleted ? 'deleted' : ''}`}
          data-active={active === h}
          onMouseMove={() => setSel(i)}
          onClick={() => open(h)}
        >
          <span className="hit-tile" aria-hidden="true">
            {mineHit ? <ListIcon size={13} /> : <SparkIcon size={13} />}
          </span>
          <span className="hit-main">
            <Snippet text={h.snippet} />
            <span className="search-meta">
              {mineHit
                ? `${h.folderTitle} · ${shortDate(h.date)}${h.deleted ? ' · disabled' : ''}`
                : `${h.digest ? 'Digest: ' : ''}${h.noteTitle} · ${h.folderTitle}${h.correction ? ' · correction' : ''}`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-query">
          <SearchIcon size={18} />
          <input
            type="search"
            autoFocus
            aria-label="Search points and notes"
            placeholder="Search your points and notes…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="seg" role="group" aria-label="Filter">
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                aria-pressed={filter === f}
                className={filter === f ? 'on' : ''}
                onClick={() => {
                  setFilter(f);
                  setSel(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="search-esc" onClick={onClose} aria-label="Close search">
            <kbd>Esc</kbd>
          </button>
        </div>

        <div className="search-body">
          <div className="search-results" ref={list}>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            {!hits && <p className="search-hint">Type to search your points and generated notes. Matching is by word prefix.</p>}
            {hits && flat.length === 0 && (
              <div className="search-hint">
                <p className="empty-title">No matches</p>
                <p>Try fewer or different words.</p>
              </div>
            )}
            {mine.length > 0 && (
              <section aria-labelledby="search-mine">
                <h2 id="search-mine" className="search-group-title">
                  Your points <span className="mono-count">{mine.length}</span>
                </h2>
                <ul className="search-list" role="list" aria-label="Matching points">
                  {mine.map((h, i) => row(h, i))}
                </ul>
              </section>
            )}
            {ai.length > 0 && (
              <section aria-labelledby="search-ai">
                <h2 id="search-ai" className="search-group-title">
                  Generated notes <span className="mono-count">{ai.length}</span>
                </h2>
                <ul className="search-list" role="list" aria-label="Matching AI text">
                  {ai.map((h, i) => row(h, mine.length + i))}
                </ul>
              </section>
            )}
          </div>

          <div className="search-preview" aria-label="Preview">
            {active && (
              <>
                <div className="preview-crumb">{active.kind === 'point' ? active.folderTitle : `${active.folderTitle} › ${active.noteTitle}`}</div>
                <h3 className="preview-title">{active.kind === 'point' ? pointTitle(active.snippet) : active.noteTitle}</h3>
                <div className="preview-tags">
                  <span className={`preview-tag ${active.kind === 'point' ? 'mine' : ''}`}>
                    {active.kind === 'point'
                      ? 'Your point'
                      : active.digest
                        ? 'Digest'
                        : active.correction
                          ? 'Correction'
                          : 'Context'}
                  </span>
                  <span className="preview-date">{active.kind === 'point' ? shortDate(active.date) : 'generated'}</span>
                </div>
                <p className={`preview-body ${active.kind === 'point' ? 'mine' : ''}`}>
                  <Snippet text={active.snippet} />
                </p>
                <button className="btn" onClick={() => open(active)}>
                  {active.kind === 'point' ? 'Show in backlog' : 'Open note'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="search-foot">
          <span>
            <kbd>↑↓</kbd> Move
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>Tab</kbd> Switch filter
          </span>
          {hits && <span className="search-count">{flat.length === 1 ? '1 result' : `${flat.length} results`}</span>}
        </div>
      </div>
    </div>
  );
}
