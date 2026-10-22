import { useEffect, useState } from 'react';

/** Pane width limits in px. The note pane always keeps at least NOTE_MIN (enforced in CSS). */
export const SIDEBAR = { initial: 220, min: 180, max: 400 };
export const BACKLOG = { initial: 300, min: 240, max: 640 };
export const NOTE_MIN = 360;

const KEY = 'lode.paneWidths';

interface Widths {
  sidebar: number;
  backlog: number;
}

function load(): Widths {
  const fallback = { sidebar: SIDEBAR.initial, backlog: BACKLOG.initial };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Widths> | null;
    const ok = (n: unknown, r: { min: number; max: number }): n is number =>
      typeof n === 'number' && n >= r.min && n <= r.max;
    return {
      sidebar: ok(v?.sidebar, SIDEBAR) ? v.sidebar : fallback.sidebar,
      backlog: ok(v?.backlog, BACKLOG) ? v.backlog : fallback.backlog,
    };
  } catch {
    return fallback;
  }
}

/** Per-device convenience: remembered pane widths. */
export function usePaneWidths(): [Widths, (patch: Partial<Widths>) => void] {
  const [w, setW] = useState<Widths>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(w));
    } catch {
      // Storage unavailable: widths just won't persist.
    }
  }, [w]);
  return [w, (patch) => setW((cur) => ({ ...cur, ...patch }))];
}
