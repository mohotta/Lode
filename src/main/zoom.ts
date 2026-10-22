export const ZOOM_MIN = -3;
export const ZOOM_MAX = 5;
const STEP = 0.5;

interface KeyInput {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}

/**
 * The zoom level a key press asks for, or null when it isn't a zoom shortcut.
 * Ctrl/Cmd + "=" zooms in ("+" too, for Ctrl+Shift+= and the numpad), "-" out, "0" resets.
 * Checks the physical code and the key, so it works on any layout and with synthetic events.
 */
export function zoomFor(input: KeyInput, current: number): number | null {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  const { key, code } = input;
  if (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+') return Math.min(ZOOM_MAX, current + STEP);
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_') return Math.max(ZOOM_MIN, current - STEP);
  if (code === 'Digit0' || code === 'Numpad0' || key === '0') return 0;
  return null;
}
