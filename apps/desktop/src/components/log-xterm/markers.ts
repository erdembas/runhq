import type { IMarker, Terminal } from '@xterm/xterm';
import { formatLineBytes, type LogLineFormatOptions } from './format';
import type { LogLine } from '@/types';

export type LogLineMarker = IMarker | undefined;

export function appendLineWithMarker(
  term: Terminal,
  line: LogLine,
  markers: LogLineMarker[],
  opts: LogLineFormatOptions,
): void {
  // xterm parses writes asynchronously. Register at the cursor position after
  // preceding writes, otherwise a replay gives every entry the same marker.
  term.write('', () => {
    const marker = term.registerMarker(0);
    // The alternate screen does not support markers. Keep its slot so later
    // markers still line up with the entries submitted to the write queue.
    markers.push(marker);
  });
  term.write(formatLineBytes(line, opts));
}

export function findLineIndexAtY(markers: LogLineMarker[], absY: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    if (!marker || marker.isDisposed) continue;
    if (marker.line <= absY) return i;
  }
  return -1;
}
