import type { LogLine } from '@/types';

export type LogBatch = Record<string, LogLine[]>;

// Service output can arrive thousands of times per second. Copy each service
// buffer once per frame-sized batch instead of once per native log event.
export function createLogBatcher(flush: (batch: LogBatch) => void, limit: number) {
  let pending: LogBatch = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    append(key: string, line: LogLine) {
      const lines = (pending[key] ??= []);
      lines.push(line);
      // Amortized trimming keeps even a burst before the timer bounded.
      if (lines.length >= limit * 2) pending[key] = lines.slice(-limit);
      timer ??= setTimeout(() => {
        timer = undefined;
        const batch = pending;
        pending = {};
        flush(batch);
      }, 32);
    },
    drop(key: string) {
      delete pending[key];
    },
  };
}

export function appendLogBatch(
  current: { lines: LogLine[]; lastSeq: number },
  incoming: LogLine[],
  limit: number,
): { lines: LogLine[]; lastSeq: number } {
  let lastSeq = current.lastSeq;
  const added = incoming.filter((line) => {
    if (line.seq <= lastSeq) return false;
    lastSeq = line.seq;
    return true;
  });
  if (added.length === 0) return current;
  return { lines: [...current.lines, ...added].slice(-limit), lastSeq };
}
