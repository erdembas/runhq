import type { IMarker, Terminal } from '@xterm/xterm';
import { findLineIndexAtY } from './markers';

interface RectLike {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
}

export function isInsideRect(rect: RectLike, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  );
}

export function lineIndexFromPointer(
  term: Terminal,
  markers: IMarker[],
  rect: RectLike,
  clientY: number,
): number {
  if (rect.height <= 0) return -1;
  const localY = clientY - rect.top;
  const cellHeight = rect.height / Math.max(1, term.rows);
  const localRow = Math.floor(localY / cellHeight);
  if (localRow < 0 || localRow >= term.rows) return -1;

  const absY = term.buffer.active.viewportY + localRow;
  return findLineIndexAtY(markers, absY);
}
