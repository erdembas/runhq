import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  TIMELINE_MAX_W,
  TIMELINE_MIN_W,
  saveTimelineCollapsed,
  saveTimelineWidth,
  syncTimelineStorage,
} from './model';
import {
  type ActivityTimelineStoreApi,
  useActivityTimelineStore,
} from './useActivityTimelineStore';

export function useTimelineChrome(store: ActivityTimelineStoreApi) {
  const collapsed = useActivityTimelineStore(store, (state) => state.collapsed);
  const width = useActivityTimelineStore(store, (state) => state.width);
  const patch = useActivityTimelineStore(store, (state) => state.patch);

  useEffect(() => {
    saveTimelineCollapsed(collapsed);
  }, [collapsed]);

  useEffect(() => {
    saveTimelineWidth(width);
  }, [width]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      syncTimelineStorage(
        event,
        (nextCollapsed) => patch({ collapsed: nextCollapsed }),
        (nextWidth) => patch({ width: nextWidth }),
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [patch]);

  const resizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      resizing.current = true;
      resizeStartX.current = event.clientX;
      resizeStartW.current = width;
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onResizeMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!resizing.current) return;
      const delta = resizeStartX.current - event.clientX;
      const next = resizeStartW.current + delta;
      patch({ width: Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, next)) });
    },
    [patch],
  );

  const onResizeEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    resizing.current = false;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // pointer might already be released
    }
  }, []);

  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const scheduleHoverOpen = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      patch({ hoverOpen: true });
      hoverTimerRef.current = null;
    }, HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, patch]);

  const scheduleHoverClose = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      patch({ hoverOpen: false });
      hoverTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer, patch]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return {
    clearHoverTimer,
    onResizeEnd,
    onResizeMove,
    onResizeStart,
    scheduleHoverClose,
    scheduleHoverOpen,
  };
}
