import { useEffect, useState } from 'react';
import type { SearchHit } from '@shared/types';
import { lode, unwrap } from '../api';
import { shortDate } from '../dates';
import { DigestIcon, HashIcon, PersonIcon, SearchIcon, SparkIcon, WarnIcon } from './Icons';

interface Props {
  vaultId: string;
  query: string;
  onQuery(q: string): void;
  onOpenPoint(folder: string, id: string): void;
  onOpenNote(folder: string, note: string, digest: boolean): void;
  onClose(): void;
}

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

/** FR-28: one search over the backlog and notes; your points and AI text are listed apart. */
export function SearchView({ vaultId, query, onQuery, onOpenPoint, onOpenNote, onClose }: Props): React.JSX.Element {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const mine = hits?.filter((h) => h.kind === 'point') ?? [];
  const ai = hits?.filter((h) => h.kind === 'ai') ?? [];

  return (
    <div className="settings search">
      <header className="center-header">
        <h1>Search</h1>
        <button className="btn" onClick={onClose}>
          Back
        </button>
      </header>
      <div className="search-box">
        <SearchIcon size={16} className="search-box-icon" />
        <input
          type="search"
          autoFocus
          aria-label="Search points and notes"
          placeholder="Search your points and notes…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {hits && hits.length === 0 && (
        <div className="empty-state">
          <SearchIcon size={28} className="empty-icon" />
          <p className="empty-title">No matches</p>
          <p>Try fewer or different words. Matching is by word prefix.</p>
        </div>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="search-mine" className="search-group">
          <h2 id="search-mine" className="search-group-title">
            <PersonIcon size={13} /> Your points <span className="day-count">{mine.length}</span>
          </h2>
          <ul className="search-list" role="list" aria-label="Matching points">
            {mine.map((h) =>
              h.kind === 'point' ? (
                <li key={h.id}>
                  <button className={`search-hit mine ${h.deleted ? 'deleted' : ''}`} onClick={() => onOpenPoint(h.folder, h.id)}>
                    <Snippet text={h.snippet} />
                    <span className="search-meta">
                      {h.folderTitle} · {shortDate(h.date)}
                      {h.deleted && ' · deleted'}
                    </span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}
      {ai.length > 0 && (
        <section aria-labelledby="search-ai" className="search-group">
          <h2 id="search-ai" className="search-group-title">
            <SparkIcon size={13} /> AI notes <span className="day-count">{ai.length}</span>
          </h2>
          <ul className="search-list" role="list" aria-label="Matching AI text">
            {ai.map((h, i) =>
              h.kind === 'ai' ? (
                <li key={`${h.folder}-${h.note}-${i}`}>
                  <button className="search-hit ai" onClick={() => onOpenNote(h.folder, h.note, h.digest)}>
                    <Snippet text={h.snippet} />
                    <span className="search-meta">
                      {h.digest ? <DigestIcon size={11} /> : <HashIcon size={11} />} {h.noteTitle} · {h.folderTitle}
                      {h.correction && (
                        <>
                          {' '}
                          · <WarnIcon size={11} /> correction
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
