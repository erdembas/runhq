interface TerminalWriteQueueOptions {
  from: number;
  to: number;
  /** Enqueue one entry and return its approximate character count. */
  append: (index: number) => number;
  /** Wait until xterm has parsed the queued entries before submitting more. */
  drain: (done: () => void) => void;
  onDrain?: () => void;
}

// Formatting a retained buffer in one effect monopolizes the UI thread on tab
// activation. Bound both formatting work and xterm's pending parse queue, then
// yield through a timer so input and modal paints can run between batches.
export function queueTerminalWrites({
  from,
  to,
  append,
  drain,
  onDrain,
}: TerminalWriteQueueOptions): () => void {
  let cancelled = false;
  let next = from;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (cancelled) return;
    const startedAt = performance.now();
    let count = 0;
    let characters = 0;
    while (next < to) {
      characters += append(next++);
      if (++count >= 128 || characters >= 65_536 || performance.now() - startedAt >= 4) break;
    }
    drain(() => {
      if (cancelled) return;
      onDrain?.();
      if (next < to) timer = setTimeout(flush, 0);
    });
  };

  if (from < to) timer = setTimeout(flush, 0);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
