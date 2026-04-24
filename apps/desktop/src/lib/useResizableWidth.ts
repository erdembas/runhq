import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** Storage key so each surface remembers its own width across sessions.
   *  Use a namespaced string like `runhq.diff.sidebar.v1` to avoid
   *  collisions if we ever rename a panel. */
  storageKey: string;
  /** Starting width if localStorage is empty / invalid. */
  defaultWidth: number;
  /** Lower bound — below this the tree rows become unreadable. */
  min: number;
  /** Upper bound — enforced both when dragging and when rehydrating from
   *  storage, so a stale value from an earlier larger cap can't leak
   *  through. */
  max: number;
}

interface Result {
  width: number;
  /** Attach to any element that should act as the drag grip. Usually a
   *  1-2 px strip on the right edge of the sidebar. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
    role: 'separator';
    'aria-orientation': 'vertical';
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  };
  /** Exposed so callers can programmatically reset. */
  setWidth: (w: number) => void;
  /** True while actively dragging — consumers can bump z-index or disable
   *  iframes while resizing if desired. */
  dragging: boolean;
}

/**
 * Generic resizable-width hook for vertical splitter handles. Clamps to
 * [min, max], persists to localStorage, supports keyboard nudging (←/→)
 * for accessibility, and double-click-to-reset (VSCode + most IDEs).
 *
 * Returning raw handler props rather than a wrapped component keeps the
 * surface flexible — the caller decides exactly where the handle sits,
 * what it looks like, and how it blends with the rest of the chrome.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max }: Options): Result {
  const clamp = useCallback((n: number) => Math.max(min, Math.min(max, n)), [min, max]);

  const [width, setWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return clamp(defaultWidth);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return clamp(defaultWidth);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return clamp(defaultWidth);
      return clamp(parsed);
    } catch {
      return clamp(defaultWidth);
    }
  });

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const persist = useCallback(
    (w: number) => {
      try {
        window.localStorage.setItem(storageKey, String(w));
      } catch {
        // swallow — localStorage unavailable (private mode, etc.) isn't
        // fatal, we just lose persistence.
      }
    },
    [storageKey],
  );

  const setWidth = useCallback(
    (w: number) => {
      const c = clamp(w);
      setWidthState(c);
      persist(c);
    },
    [clamp, persist],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      setWidthState(clamp(drag.startWidth + delta));
    },
    [clamp],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragStateRef.current) return;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may already be released (e.g. if the element unmounted
        // mid-drag). Safe to ignore.
      }
      dragStateRef.current = null;
      setDragging(false);
      // Persist the final value once dragging finishes — avoids hammering
      // localStorage on every pointermove.
      setWidthState((w) => {
        persist(w);
        return w;
      });
    },
    [persist],
  );

  const onDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth, setWidth]);

  // Keyboard nudging — hold Shift for coarse 32px steps, otherwise 8px.
  // Matches the pattern used elsewhere in the sidebar rail resizer.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.shiftKey ? 32 : 8;
      const sign = e.key === 'ArrowLeft' ? -1 : 1;
      setWidth(width + step * sign);
    },
    [width, setWidth],
  );

  // Re-clamp when min/max change at runtime (unlikely but guards against
  // drift when a parent swaps its config props).
  useEffect(() => {
    setWidthState((w) => clamp(w));
  }, [clamp]);

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onDoubleClick,
      role: 'separator',
      'aria-orientation': 'vertical',
      tabIndex: 0,
      onKeyDown,
    },
    setWidth,
    dragging,
  };
}
