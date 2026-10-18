import { useRef } from 'react';

interface Props {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string;
  width: number;
  min: number;
  max: number;
  /** Width used by double-click and Home. */
  initial: number;
  onResize(width: number): void;
}

const STEP = 16;

/**
 * Drag handle on a pane's right edge. Also a focusable separator: Left/Right arrows resize,
 * Home resets, and double-click resets. Sits inside a `position: relative` pane.
 */
export function Resizer({ label, width, min, max, initial, onResize }: Props): React.JSX.Element {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number): number => Math.round(Math.min(max, Math.max(min, w)));

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(clamp(drag.current.w + e.clientX - drag.current.x));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing');
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={() => onResize(clamp(initial))}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft' ? width - STEP : e.key === 'ArrowRight' ? width + STEP : e.key === 'Home' ? initial : null;
        if (next === null) return;
        e.preventDefault();
        onResize(clamp(next));
      }}
    />
  );
}
