import { useEffect } from 'react';
import { CloseIcon } from './Icons';

/** Closes a page or overlay on Escape, unless something inside already handled the key. */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** The bar on top of Settings, Review and Trash: icon, title, a quiet note and an Esc close button. */
export function PageHeader({ icon, title, note, closeLabel, onClose }: {
  icon?: React.ReactNode;
  title: string;
  note?: string;
  closeLabel: string;
  onClose(): void;
}): React.JSX.Element {
  useEscape(onClose);
  return (
    <header className="set-head">
      <div className="set-title">
        {icon && <span className="set-icon">{icon}</span>}
        <h1>{title}</h1>
        {note && <span className="muted">· {note}</span>}
      </div>
      <button className="btn set-close" aria-label={closeLabel} title="Close (Esc)" onClick={onClose}>
        <kbd>Esc</kbd>
        <CloseIcon size={12} />
      </button>
    </header>
  );
}
