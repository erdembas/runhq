import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { DEFAULT_W, MAX_W, MIN_W } from './dnd';

export function useSidebarRailResize() {
  const [width, setWidth] = useState(DEFAULT_W);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onResizeStart = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      resizing.current = true;
      startX.current = e.clientX;
      startW.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onResizeMove = useCallback((e: PointerEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - startX.current;
    setWidth(Math.max(MIN_W, Math.min(MAX_W, startW.current + delta)));
  }, []);

  const onResizeEnd = useCallback(() => {
    resizing.current = false;
  }, []);

  return { width, onResizeStart, onResizeMove, onResizeEnd };
}
