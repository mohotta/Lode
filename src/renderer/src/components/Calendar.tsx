import { useEffect, useRef, useState } from 'react';
import { localDate } from '../dates';
import { ArrowLeftIcon, ArrowRightIcon } from './Icons';

interface Props {
  /** Selected day, YYYY-MM-DD. */
  value: string;
  /** Latest selectable day (inclusive), YYYY-MM-DD. */
  max: string;
  onPick(date: string): void;
  onClose(): void;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const parse = (d: string): Date => new Date(`${d}T00:00:00`);
const addDays = (d: string, n: number): string => {
  const x = parse(d);
  x.setDate(x.getDate() + n);
  return localDate(x);
};

/** Six Monday-first weeks covering the month that contains `month` (any day in it). */
function grid(month: Date): string[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return localDate(d);
  });
}

/** Themed month picker (the native one can't follow the app's colours). Arrows move, Enter picks, Escape closes. */
export function Calendar({ value, max, onPick, onClose }: Props): React.JSX.Element {
  const [focus, setFocus] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const month = parse(focus);
  const days = grid(month);
  const maxMonth = parse(max);
  const atLatestMonth =
    month.getFullYear() > maxMonth.getFullYear() ||
    (month.getFullYear() === maxMonth.getFullYear() && month.getMonth() >= maxMonth.getMonth());

  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const move = (to: string): void => setFocus(to > max ? max : to);
  const shiftMonth = (n: number): void => {
    const d = parse(focus);
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), last));
    move(localDate(target));
  };

  const onKey = (e: React.KeyboardEvent): void => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      move(addDays(focus, step[e.key] ?? 0));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      shiftMonth(e.key === 'PageUp' ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <div ref={root} className="calendar" role="dialog" aria-label="Choose a day" onKeyDown={onKey}>
      <div className="cal-head">
        <span className="cal-title" aria-live="polite">
          {title}
        </span>
        <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
          <ArrowLeftIcon size={14} />
        </button>
        <button className="icon-btn" aria-label="Next month" disabled={atLatestMonth} onClick={() => shiftMonth(1)}>
          <ArrowRightIcon size={14} />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label={title}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-wd" role="columnheader">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const out = parse(d).getMonth() !== month.getMonth();
          return (
            <button
              key={d}
              data-day={d}
              role="gridcell"
              tabIndex={d === focus ? 0 : -1}
              aria-selected={d === value}
              aria-label={parse(d).toLocaleDateString(undefined, { dateStyle: 'full' })}
              disabled={d > max}
              className={`cal-day ${out ? 'out' : ''} ${d === value ? 'sel' : ''} ${d === max ? 'today' : ''}`}
              onClick={() => onPick(d)}
            >
              {parse(d).getDate()}
            </button>
          );
        })}
      </div>
      <div className="cal-foot">
        <button className="link-btn" onClick={() => onPick(max)}>
          Today
        </button>
      </div>
    </div>
  );
}
