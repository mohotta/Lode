import { forwardRef, useRef, useState } from 'react';
import { localDate, shortDate } from '../dates';
import { CalendarIcon, CloseIcon, PlusIcon, ReturnIcon } from './Icons';

interface Props {
  folderTitle: string;
  /** `date` is set only when the user picked a day other than today. */
  onAdd(text: string, date?: string): Promise<void>;
}

/**
 * Enter adds the point; Shift+Enter inserts a newline for multi-line points.
 * A picked date stays until changed or reset (handy for backfilling one day).
 */
export const Scratchpad = forwardRef<HTMLTextAreaElement, Props>(function Scratchpad({ folderTitle, onAdd }, ref) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const today = localDate(new Date());
  // A picked date that has become "today" (or is invalid/future) behaves like no pick.
  const picked = date && date < today ? date : null;

  const submit = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text, picked ?? undefined);
      setText('');
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
          onChange={(e) => setText(e.target.value)}
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
        {picked && <span className="composer-note">New points go to {shortDate(picked)}</span>}
        <span className="composer-md-hint">
          Markdown · <code>```</code> for code · <kbd>Shift</kbd>+<kbd>↵</kbd> new line
        </span>
      </div>
    </div>
  );
});
