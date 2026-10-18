import { useEffect, useRef, useState } from 'react';
import type { DigestKind, DigestPeriod } from '@shared/types';
import { lode, unwrap } from '../api';

interface Props {
  vaultId: string;
  folder: string;
  folderTitle: string;
  onPick(period: DigestPeriod): void;
  onClose(): void;
}

/** Choose a week or month to recap (FR-26). Only periods that have points are offered. */
export function DigestPicker({ vaultId, folder, folderTitle, onPick, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [periods, setPeriods] = useState<DigestPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DigestKind>('week');

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

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="digest-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="digest-title">New digest · {folderTitle}</h2>
      <div className="segmented" role="tablist" aria-label="Digest length">
        {(['week', 'month'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {k === 'week' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {periods && shown.length === 0 && <p className="muted">No points yet for a {kind === 'week' ? 'weekly' : 'monthly'} digest.</p>}
      <ul className="period-list" role="list" aria-label="Periods">
        {shown.map((p) => (
          <li key={p.id}>
            <button className="period" onClick={() => onPick(p)}>
              <span className="period-title">{p.title}</span>
              <span className="period-sub">
                {p.points} {p.points === 1 ? 'point' : 'points'}
                {p.exists && ' · has a digest'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button className="btn" onClick={close}>
          Close
        </button>
      </div>
    </dialog>
  );
}
