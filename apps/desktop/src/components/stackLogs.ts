import type { LogLine } from '@/types';

/** Each command buffer is already in sequence order. Its older entries cannot
 * appear in the combined tail, so avoid copying/sorting whole retained buffers. */
export function mergeRecentLogLines(buffers: readonly LogLine[][], limit: number): LogLine[] {
  if (limit <= 0) return [];
  const candidates = buffers.flatMap((lines) => lines.slice(-limit));
  candidates.sort((a, b) => a.seq - b.seq);
  return candidates.slice(-limit);
}
