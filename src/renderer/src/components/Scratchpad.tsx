import { forwardRef, useRef, useState } from 'react';
import { localDate, shortDate } from '../dates';
import { CalendarIcon, CloseIcon, CopyIcon, PlusIcon, ReturnIcon } from './Icons';

export interface DuplicateInfo {
  id: string;
  text: string;
  date: string;
  exact: boolean;
}

interface Props {
  folderTitle: string;
  /**
   * `date` is set only when the user picked a day other than today. Resolves with the
   * earlier point when the text looks like a repeat (nothing was added), else null.
   */
  onAdd(text: string, date?: string, force?: boolean): Promise<DuplicateInfo | null>;
  onShowPoint(id: string): void;
}

function excerpt(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 90 ? `${one.slice(0, 90)}…` : one;
}

/**
 * Enter adds the point; Shift+Enter inserts a newline for multi-line points.
 * A picked date stays until changed or reset (handy for backfilling one day).
 */
export const Scratchpad = forwardRef<HTMLTextAreaElement, Props>(function Scratchpad(
  { folderTitle, onAdd, onShowPoint },
  ref,
) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<DuplicateInfo | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const today = localDate(new Date());
  // A picked date that has become "today" (or is invalid/future) behaves like no pick.
  const picked = date && date < today ? date : null;

  const submit = async (force = false): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const repeat = await onAdd(text, picked ?? undefined, force);
      setDup(repeat);
      if (!repeat) setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-wrap">
      <div className={`composer ${text ? 'has-text' : ''}`}>
        <PlusIcon size={15} className="composer-icon" />
        <label htmlFor="scratchpad-input" className="visually-hidden">
          Add a point to {folderTitle}
        </label>
        <textarea
          id="scratchpad-input"
          ref={ref}
          className="composer-input"
          placeholder={picked ? `What did you learn on ${shortDate(picked)}?` : 'What did you learn?'}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          value={text}
          maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            setDup(null);
          }}
          onKeyDown={(e) => {
            // Inside an unclosed ``` fence, Enter is a newline so code can be typed naturally.
            const inFence = ((text.match(/^\s*```/gm) ?? []).length % 2) === 1;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !inFence) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <span className="composer-hint" aria-hidden="true">
          <kbd>
            <ReturnIcon size={12} />
          </kbd>
        </span>
      </div>

      {dup && (
        <div className={`dup-notice ${dup.exact ? 'exact' : ''}`} role="status">
          <CopyIcon size={14} className="dup-icon" />
          <div className="dup-text">
            <strong>{dup.exact ? 'Already in your backlog' : 'Looks like an earlier point'}</strong>
            <span>
              {shortDate(dup.date)} · “{excerpt(dup.text)}”
            </span>
          </div>
          <div className="dup-actions">
            <button className="btn" onClick={() => onShowPoint(dup.id)}>
              Show
            </button>
            {!dup.exact && (
              <button className="btn primary" onClick={() => void submit(true)}>
                Add anyway
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setDup(null)}>
              <CloseIcon size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="composer-tools">
        <div className={`date-chip ${picked ? 'set' : ''}`}>
          <button
            type="button"
            className="date-chip-btn"
            title="Choose the day this point belongs to"
            onClick={() => {
              const el = picker.current;
              if (!el) return;
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            }}
          >
            <CalendarIcon size={13} />
            <span>{picked ? shortDate(picked) : 'Today'}</span>
          </button>
          {picked && (
            <button
              type="button"
              className="date-chip-reset"
              aria-label="Reset date to today"
              title="Reset to today"
              onClick={() => setDate(null)}
            >
              <CloseIcon size={11} />
            </button>
          )}
          <input
            ref={picker}
            type="date"
            className="date-input"
            aria-label="Entry date"
            max={today}
            value={picked ?? today}
            onChange={(e) => {
              const v = e.target.value;
              setDate(v && v < today ? v : null);
            }}
          />
        </div>
        {picked && (
          <span className="composer-note" title={`New points go to ${shortDate(picked)}`}>
            New points go to {shortDate(picked)}
          </span>
        )}
        <span className="composer-md-hint">
          Markdown · <code>```</code> for code · <kbd>Shift</kbd>+<kbd>↵</kbd> new line
        </span>
      </div>
    </div>
  );
});
