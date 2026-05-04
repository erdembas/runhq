import type { IMarker, Terminal } from '@xterm/xterm';
import { formatLineBytes, type LogLineFormatOptions } from './format';
import type { LogLine } from '@/types';

export function appendLineWithMarker(
  term: Terminal,
  line: LogLine,
  markers: IMarker[],
  opts: LogLineFormatOptions,
): void {
  const marker = term.registerMarker(0);
  if (marker) markers.push(marker);
  term.write(formatLineBytes(line, opts));
}

export function findLineIndexAtY(markers: IMarker[], absY: number): number {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    if (!marker || marker.isDisposed) continue;
    if (marker.line <= absY) return i;
  }
  return -1;
}
