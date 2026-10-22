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

/** Accent colours: a light-theme and a dark-theme shade of each, both readable on their background. */
export const ACCENTS = {
  amber: { label: 'Amber', light: '#b4761c', dark: '#e8b65a' },
  blue: { label: 'Blue', light: '#2f6fd6', dark: '#7aa7ff' },
  green: { label: 'Green', light: '#2f8a4c', dark: '#5ac17d' },
  teal: { label: 'Teal', light: '#11827a', dark: '#4fc7bb' },
  violet: { label: 'Violet', light: '#7b4fd1', dark: '#b49bff' },
  rose: { label: 'Rose', light: '#c2416b', dark: '#f27aa0' },
  graphite: { label: 'Graphite', light: '#55585f', dark: '#c4c7ce' },
} as const;
export type Accent = keyof typeof ACCENTS;
const ACCENT_KEY = 'lode.accent';

function loadAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v && v in ACCENTS ? (v as Accent) : 'amber';
  } catch {
    return 'amber';
  }
}

/** Per-device convenience: sets --accent-l/--accent-d on the root; the CSS tokens derive the rest. */
export function useAccent(): [Accent, (a: Accent) => void] {
  const [accent, setAccent] = useState<Accent>(loadAccent);
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty('--accent-l', ACCENTS[accent].light);
    el.style.setProperty('--accent-d', ACCENTS[accent].dark);
    try {
      localStorage.setItem(ACCENT_KEY, accent);
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  }, [accent]);
  return [accent, setAccent];
}
