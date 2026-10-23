import { useEffect, useRef, useState } from 'react';
import { setConfirmOpener, type AskOptions } from '../api';
import { InfoIcon, TrashIcon, WarnIcon } from './Icons';

interface Pending extends AskOptions {
  resolve(ok: boolean): void;
}

/**
 * The app's confirmation dialog, styled like the rest of Lode (not an OS box). Mounted once;
 * `ask()` opens it. Esc or Cancel answers no, Enter or the confirm button answers yes.
 */
export function ConfirmHost(): React.JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setConfirmOpener(
      (opts) =>
        new Promise<boolean>((resolve) => {
          setPending((prev) => {
            prev?.resolve(false);
            return { ...opts, resolve };
          });
        }),
    );
    return () => setConfirmOpener(null);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (pending && d && !d.open) d.showModal();
  }, [pending]);

  const answer = (ok: boolean): void => {
    pending?.resolve(ok);
    ref.current?.close();
    setPending(null);
  };

  if (!pending) return null;
  // Trash or delete actions get a trash icon. Only irreversible ones (`danger`) use the warning
  // colour; everything else, like a restorable move to trash, uses the user's accent.
  const trashy = /trash|delete|remove/i.test(pending.confirmLabel);
  return (
    <dialog
      ref={ref}
      className="dialog v2 confirm"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby={pending.detail ? 'confirm-detail' : undefined}
      // Esc answers no. Marked handled so pages that close on Esc (Review, Trash) stay open.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        answer(false);
      }}
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      onMouseDown={(e) => e.target === e.currentTarget && answer(false)}
    >
      <div className="confirm-body">
        <span className={`confirm-icon ${pending.danger ? 'danger' : ''}`} aria-hidden="true">
          {trashy ? <TrashIcon size={16} /> : pending.danger ? <WarnIcon size={16} /> : <InfoIcon size={16} />}
        </span>
        <div>
          <h2 id="confirm-title">{pending.message}</h2>
          {pending.detail && <p id="confirm-detail">{pending.detail}</p>}
        </div>
      </div>
      <div className="dlg-foot">
        <button className="btn" onClick={() => answer(false)}>
          Cancel
        </button>
        <button autoFocus className={`btn ${pending.danger ? 'danger-soft' : 'primary'}`} onClick={() => answer(true)}>
          {pending.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
