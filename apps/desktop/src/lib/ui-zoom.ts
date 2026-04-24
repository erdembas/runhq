import { useEffect } from 'react';

const STORAGE_KEY = 'runhq.ui-scale';
const MIN = 0.85;
const MAX = 1.4;
const STEP = 0.05;
const DEFAULT = 1;

function clamp(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT;
  const stepped = Math.round(v / STEP) * STEP;
  return Math.min(MAX, Math.max(MIN, stepped));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT;
    return clamp(Number(raw));
  } catch {
    return DEFAULT;
  }
}

function apply(scale: number): void {
  // `zoom` is non-standard but works in WKWebView (Tauri) and Chromium.
  // Using `transform: scale` would break the window's bounding box; `zoom`
  // reflows everything including Tailwind arbitrary px sizes.
  document.documentElement.style.zoom = String(scale);
}

export function useUiZoomShortcuts(): void {
  useEffect(() => {
    apply(readStored());

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const current = readStored();
      let next: number | null = null;

      // `e.key` reflects the character the layout produces, but macOS bypasses
      // layout processing while Cmd is held — so Cmd+Shift+0 on Turkish Q/F
      // (where `=` sits on Shift+0) arrives as `e.key === '0'`, never `'='`.
      // To stay usable on every layout we bind the zero row directly:
      //   Cmd+0 → zoom in, Cmd+Shift+0 → reset.
      // The `=`/`+` keys still work for US layouts where Cmd+= produces `=`.
      const isZeroKey = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0';
      const isEqualish = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd';
      const isMinusish = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract';

      if (isZeroKey && e.shiftKey) next = DEFAULT;
      else if (isZeroKey) next = clamp(current + STEP);
      else if (isEqualish) next = clamp(current + STEP);
      else if (isMinusish) next = clamp(current - STEP);

      if (next == null) return;

      e.preventDefault();
      e.stopPropagation();
      try {
        localStorage.setItem(STORAGE_KEY, next.toFixed(2));
      } catch {
        // Storage may be disabled (private mode); the zoom still applies
        // for the current session.
      }
      apply(next);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
