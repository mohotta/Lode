import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'lode.theme';

function load(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Per-device convenience only; the CSS falls back to the OS preference. */
export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>(load);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  }, [theme]);
  return [theme, setTheme];
}
