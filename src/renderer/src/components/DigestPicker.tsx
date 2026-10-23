import { useEffect, useRef, useState } from 'react';
import type { DigestKind, DigestPeriod } from '@shared/types';
import { lode, unwrap } from '../api';
import { DigestIcon } from './Icons';

interface Props {
  vaultId: string;
  folder: string;
  folderTitle: string;
  onPick(period: DigestPeriod): void;
  /** A period that already has a digest: open it instead of writing another. */
  onOpen(period: DigestPeriod): void;
  onClose(): void;
}

function span(p: DigestPeriod): string {
  const d = (s: string, opts: Intl.DateTimeFormatOptions): string => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, opts);
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  return sameMonth
    ? `${d(p.from, { month: 'short', day: 'numeric' })}–${d(p.to, { day: 'numeric' })}, ${p.from.slice(0, 4)}`
    : `${d(p.from, { month: 'short', day: 'numeric' })} – ${d(p.to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Choose a week or month to recap (FR-26). Only periods that have points are offered. */
export function DigestPicker({ vaultId, folder, folderTitle, onPick, onOpen, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [periods, setPeriods] = useState<DigestPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DigestKind>('week');
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    let cancelled = false;
    unwrap(lode.digest.periods(vaultId, folder)).then(
      (p) => !cancelled && setPeriods(p),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, folder]);

  const close = (): void => {
    ref.current?.close();
    onClose();
  };
  const shown = periods?.filter((p) => p.kind === kind) ?? [];
  // Default to the newest period that has no digest yet.
  const selected = shown.find((p) => p.id === chosen && !p.exists) ?? shown.find((p) => !p.exists);

  return (
    <dialog
      ref={ref}
      className="dialog v2"
      aria-labelledby="digest-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dlg-head">
        <span className="dlg-icon" aria-hidden="true">
          <DigestIcon size={15} />
        </span>
        <div>
          <h2 id="digest-title">New digest</h2>
          <p className="dlg-sub">{folderTitle} · a summary of the points from one period</p>
        </div>
      </div>
      <div className="dlg-body">
        <div className="seg wide" role="group" aria-label="Period length">
          {(['week', 'month'] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <div className="dlg-cap">Choose a period</div>
        {periods && shown.length === 0 && (
          <p className="muted small">No points yet for a {kind === 'week' ? 'weekly' : 'monthly'} digest.</p>
        )}
        <div className="period-list" role="radiogroup" aria-label="Periods">
          {shown.map((p) => {
            const on = selected?.id === p.id;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={on}
                className={`period-opt ${on ? 'on' : ''} ${p.exists ? 'made' : ''}`}
                onClick={() => (p.exists ? onOpen(p) : setChosen(p.id))}
                title={p.exists ? 'Already has a digest. Open it.' : undefined}
              >
                <span className="radio-dot" aria-hidden="true" />
                <span className="row-main">
                  <span className="row-title">{p.title}</span>
                  <span className="row-sub">{span(p)}</span>
                </span>
                <span className={`period-note ${p.exists ? 'open' : ''}`}>
                  {p.exists ? 'Already made · Open' : `${p.points} ${p.points === 1 ? 'point' : 'points'}`}
                </span>
              </button>
            );
          })}
        </div>
        <p className="dlg-note">Only periods with points are listed.</p>
      </div>
      <div className="dlg-foot">
        <span className="dlg-foot-note">Runs in the background</span>
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
          {selected || shown.length === 0 ? 'Create digest' : 'Nothing new'}
        </button>
      </div>
    </dialog>
  );
}
