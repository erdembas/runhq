import { cn } from '@/lib/cn';

interface TokenMeterProps {
  /** Estimated token count for the prompt about to be sent (history +
   *  composer + system messages). `null` while the count is in
   *  flight on a fresh mount — we render a dim placeholder so the
   *  composer doesn't reflow when the first count lands. */
  count: number | null;
  /** Total context window for the active provider, in tokens. `null`
   *  when the user hasn't configured one in AI Settings — we hide
   *  the denominator gauge but still render the raw count, since
   *  knowing "this prompt is 12k tokens" is useful even without a
   *  cap reference. */
  contextWindow: number | null;
  className?: string;
}

/**
 * Cursor-style "context length" indicator for the chat composer.
 *
 * Three rendering modes:
 *
 * 1. **No window configured** — show `12.4k` as plain text. The user
 *    learns the rough size of their prompt without us inventing a
 *    cap they didn't pin down.
 * 2. **Window configured, well below cap** — show `12.4k / 128k` in
 *    the muted foreground tone with a thin progress dot.
 * 3. **Approaching / over cap** — show the same `used / total` but
 *    flip the color to amber (≥75%) or red (≥95%/over) so the user
 *    notices before hitting a 4xx mid-stream.
 *
 * Why a static threshold model and not a dynamic "estimated cost":
 * - The user already paid for the model with cycles/dollars. The
 *   relevant question at composer-write time is "will this fit?",
 *   not "what does this cost?". Cost belongs in a different surface.
 * - Static thresholds are predictable. A user who sees amber once
 *   knows it'll be amber at the same fill next time, and that builds
 *   trust in the meter.
 */
export function TokenMeter({ count, contextWindow, className }: TokenMeterProps) {
  if (count == null) {
    return (
      <span
        className={cn('text-fg-dim/60 font-mono text-[10.5px] tabular-nums', className)}
        aria-hidden="true"
      >
        … tok
      </span>
    );
  }

  const fmtCount = formatTokens(count);

  if (!contextWindow || contextWindow <= 0) {
    return (
      <span
        className={cn('text-fg-dim font-mono text-[10.5px] tabular-nums', className)}
        title={`${count.toLocaleString()} tokens (estimated)`}
      >
        {fmtCount} tok
      </span>
    );
  }

  const ratio = count / contextWindow;
  const tone = toneFor(ratio);
  const fmtTotal = formatTokens(contextWindow);

  return (
    <span
      className={cn(
        'flex items-center gap-1 font-mono text-[10.5px] tabular-nums',
        tone.text,
        className,
      )}
      title={
        ratio >= 1
          ? `Over context window: ${count.toLocaleString()} / ${contextWindow.toLocaleString()}. The provider will likely reject this request — trim chat history or shorten the message.`
          : ratio >= 0.95
            ? `Almost at the context window: ${count.toLocaleString()} / ${contextWindow.toLocaleString()}.`
            : ratio >= 0.75
              ? `Heading toward the context window: ${count.toLocaleString()} / ${contextWindow.toLocaleString()}.`
              : `${count.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (estimated).`
      }
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      <span>
        {fmtCount} / {fmtTotal}
      </span>
    </span>
  );
}

/** Compact human-readable formatter — `12345 → "12.3k"`, `987 → "987"`,
 *  `1_204_000 → "1.20M"`. Kept inline rather than reaching for a
 *  formatter dep because the rules are this short. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(2)}k`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

interface Tone {
  text: string;
  dot: string;
}

function toneFor(ratio: number): Tone {
  if (ratio >= 0.95) {
    return { text: 'text-status-error', dot: 'bg-status-error' };
  }
  if (ratio >= 0.75) {
    return { text: 'text-status-starting', dot: 'bg-status-starting' };
  }
  return { text: 'text-fg-dim', dot: 'bg-fg-dim/50' };
}
