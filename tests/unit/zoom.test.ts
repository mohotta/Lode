import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, zoomFor } from '../../src/main/zoom';

const key = (key: string, code: string, mods: Partial<{ control: boolean; meta: boolean; alt: boolean }> = { control: true }) => ({
  type: 'keyDown',
  key,
  code,
  control: false,
  meta: false,
  alt: false,
  ...mods,
});

describe('zoomFor', () => {
  it('Ctrl = zooms in, Ctrl - zooms out, Ctrl 0 resets', () => {
    expect(zoomFor(key('=', 'Equal'), 0)).toBe(0.5);
    expect(zoomFor(key('-', 'Minus'), 1)).toBe(0.5);
    expect(zoomFor(key('0', 'Digit0'), 2)).toBe(0);
  });

  it('accepts Ctrl+Shift+= ("+"), the numpad, Cmd on macOS, and events without a code', () => {
    expect(zoomFor(key('+', 'Equal'), 0)).toBe(0.5);
    expect(zoomFor(key('+', 'NumpadAdd'), 0)).toBe(0.5);
    expect(zoomFor(key('=', 'Equal', { meta: true }), 0)).toBe(0.5);
    expect(zoomFor(key('=', ''), 0)).toBe(0.5);
    expect(zoomFor(key('-', ''), 0)).toBe(-0.5);
  });

  it('clamps to the allowed range', () => {
    expect(zoomFor(key('=', 'Equal'), ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomFor(key('-', 'Minus'), ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  it('ignores other keys, missing modifiers, Alt combos and key-up', () => {
    expect(zoomFor(key('k', 'KeyK'), 0)).toBeNull();
    expect(zoomFor(key('=', 'Equal', {}), 0)).toBeNull();
    expect(zoomFor(key('=', 'Equal', { control: true, alt: true }), 0)).toBeNull();
    expect(zoomFor({ ...key('=', 'Equal'), type: 'keyUp' }, 0)).toBeNull();
  });
});
