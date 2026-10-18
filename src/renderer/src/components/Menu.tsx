import { useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  checked?: boolean;
  onSelect(): void;
}

interface Props {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: React.ReactNode;
  items: (MenuItem | 'separator')[];
  align?: 'start' | 'end';
  triggerClassName?: string;
  title?: string;
}

/** Minimal menu button: Enter/Space opens, arrows move, Escape and outside clicks close. */
export function Menu({ label, trigger, items, align = 'start', triggerClassName, title }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent): void => {
    const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    }
  };

  return (
    <div className="menu-root" ref={root} onKeyDown={onKey}>
      <button
        ref={button}
        className={triggerClassName ?? 'icon-btn'}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu" id={id} aria-label={label}>
          {items.map((it, i) =>
            it === 'separator' ? (
              <div key={`sep-${i}`} className="menu-sep" role="separator" />
            ) : (
              <button
                key={it.label}
                role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.checked}
                className={`menu-item ${it.danger ? 'danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span className="menu-icon">{it.icon}</span>
                <span className="menu-label">{it.label}</span>
                {it.checked && <span className="menu-check">✓</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
