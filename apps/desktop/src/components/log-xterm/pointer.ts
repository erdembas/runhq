import type { Terminal } from '@xterm/xterm';
import type { LogLine } from '@/types';
import { findLineIndexAtY, type LogLineMarker } from './markers';

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
  markers: LogLineMarker[],
  writtenSeqs: readonly number[],
  lines: readonly Pick<LogLine, 'seq'>[],
  rect: RectLike,
  clientY: number,
): number {
  if (rect.height <= 0 || term.buffer.active.type === 'alternate') return -1;
  const localY = clientY - rect.top;
  const cellHeight = rect.height / Math.max(1, term.rows);
  const localRow = Math.floor(localY / cellHeight);
  if (localRow < 0 || localRow >= term.rows) return -1;

  const absY = term.buffer.active.viewportY + localRow;
  const markerIndex = findLineIndexAtY(markers, absY);
  const sequence = writtenSeqs[markerIndex];
  if (sequence === undefined) return -1;
  // The source buffer can advance before the next asynchronous write batch
  // realigns markers. Resolve by sequence so a context action never targets a
  // different entry after retention trimming or filtering.
  if (lines[markerIndex]?.seq === sequence) return markerIndex;
  return lines.findIndex((line) => line.seq === sequence);
}
