import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { localDate, shortDate } from '../dates';
import { CalendarIcon, CloseIcon, CopyIcon } from './Icons';
import { Calendar } from './Calendar';
import { RichEditor, type RichEditorHandle } from './RichEditor';

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
 * Rich editor that stores markdown. Enter adds the point; Shift+Enter breaks the line;
 * inside a code block or list, Enter continues it and Ctrl+Enter adds.
 * A picked date stays until changed or reset (handy for backfilling one day).
 */
export const Scratchpad = forwardRef<RichEditorHandle, Props>(function Scratchpad(
  { folderTitle, onAdd, onShowPoint },
  ref,
) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<DuplicateInfo | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const today = localDate(new Date());
  // A picked date that has become "today" (or is invalid/future) behaves like no pick.
  const picked = date && date < today ? date : null;

  const editor = useRef<RichEditorHandle | null>(null);
  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    clear: () => editor.current?.clear(),
  }));

  const submit = async (value = text, force = false): Promise<void> => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const repeat = await onAdd(value, picked ?? undefined, force);
      setDup(repeat);
      if (!repeat) {
        editor.current?.clear();
        setText('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-wrap">
      <div className={`composer ${text ? 'has-text' : ''}`}>
        <RichEditor
          ref={editor}
          label={`Add a point to ${folderTitle}`}
          placeholder={picked ? `What did you learn on ${shortDate(picked)}?` : 'What did you learn?'}
          onChange={(md) => {
            setText(md);
            setDup(null);
          }}
          onSubmit={(md) => void submit(md)}
        />
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
              <button className="btn primary" onClick={() => void submit(text, true)}>
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
            aria-haspopup="dialog"
            aria-expanded={calendar}
            // Don't let the calendar's outside-click close fire before this toggle.
            onMouseDown={(e) => calendar && e.stopPropagation()}
            onClick={() => setCalendar((o) => !o)}
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
          {calendar && (
            <Calendar
              value={picked ?? today}
              max={today}
              onPick={(d) => {
                setDate(d < today ? d : null);
                setCalendar(false);
                editor.current?.focus();
              }}
              onClose={() => setCalendar(false)}
            />
          )}
          {/* Typed entry for keyboard users (visible on focus); the calendar is the pointer path. */}
          <input
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
          <kbd>↵</kbd> add · <kbd>Shift</kbd>+<kbd>↵</kbd> new line · <code>```</code> code
        </span>
      </div>
    </div>
  );
});
