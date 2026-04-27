import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

interface ReasoningPillProps {
  /** Full chain-of-thought text. Hidden by default — only shown
   * when the user expands the pill. */
  reasoning: string;
  /** Epoch ms (`Date.now()`) when the reasoning phase began. */
  startedAtMs: number | null;
  /** Epoch ms when the reasoning phase ended — when the model
   * started emitting answer tokens, or the stream finished. While
   * `null`, the pill renders in live "Thinking…" mode with a
   * shimmer animation and a ticking timer. */
  endedAtMs: number | null;
  className?: string;
}

/// Cursor-style "thinking pill".
///
/// Two visual modes driven by `endedAtMs`:
///
///   - **Live** (`endedAtMs == null`): pulsing brain icon, shimmer
///     on the label ("Thinking… 4.2s"), live timer recomputed every
///     ~100ms. The body is hidden by default but expandable so the
///     curious user can peek behind the curtain mid-stream.
///   - **Frozen** (`endedAtMs` set): static "Thought for 4.2s" pill,
///     collapsed by default. Click to expand into a recessed mono
///     panel that scrolls if the trace is long.
///
/// The pill never spills its content into the answer body, mirroring
/// Cursor's behaviour: the user sees the answer take centre stage,
/// and the reasoning is one click away when they want it.
export function ReasoningPill({
  reasoning,
  startedAtMs,
  endedAtMs,
  className,
}: ReasoningPillProps) {
  // Default to open. The pill is the user's window into "how did the
  // model get here" — Cursor opens it by default during thinking and
  // we found the same is more useful for engineering content (diff
  // review, log triage, standup polish): the trace explains tone and
  // bullet ordering choices the model made, and burying it behind a
  // click made users assume the model gave up. The user can still
  // collapse with a single click; we don't override that on each
  // render so their preference within a turn sticks.
  const [open, setOpen] = useState(true);
  const live = startedAtMs !== null && endedAtMs === null;

  // Force re-render every 100ms while the model is thinking so the
  // duration counter ticks. Cheap: this component is short-lived
  // and the work per tick is `Date.now()` + a render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => forceTick((n) => (n + 1) % 1_000_000), 100);
    return () => window.clearInterval(id);
  }, [live]);

  // Anchor the freeze: capture and remember the elapsed value the
  // first time the phase ends. Without this, very fast components
  // can briefly show "Thought for 99ms" then "Thought for 0.1s" as
  // the floor kicks in — distracting flicker. Hook is declared
  // before any early return so the rules-of-hooks invariant holds.
  const frozenLabelRef = useRef<string | null>(null);

  // Scroll-to-bottom behaviour for the trace panel. The reasoning
  // text streams in token-by-token and the panel is only ~70px tall
  // — without auto-scrolling, the user stares at the *first* few
  // lines of the model's monologue while the actually-interesting
  // latest tokens scroll out of sight at the bottom. We pin to the
  // tail on every update, which mirrors how Cursor / Codex / chat
  // log views work. We track a "user scrolled up" bit so we DON'T
  // hijack the scroll if the user is reading earlier reasoning —
  // the moment they manually scroll up, we back off until they
  // scroll back to the bottom (or the pill is closed and reopened).
  const traceRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = traceRef.current;
    if (!el || !open || !stickToBottomRef.current) return;
    // `scrollTop = scrollHeight` is enough — we don't need
    // `requestAnimationFrame` here because React has already
    // committed the new DOM by the time this effect fires.
    el.scrollTop = el.scrollHeight;
  }, [reasoning, open]);
  // Detect whether the user has scrolled away from the bottom. We
  // give a 4px tolerance because some browsers leave fractional
  // sub-pixel offsets at the true bottom (especially on retina
  // displays); requiring exact `0` would falsely flag the pill as
  // "user scrolled up" right after our own programmatic snap.
  const handleScroll = () => {
    const el = traceRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 4;
  };
  // Re-arm sticky mode whenever the user collapses/reopens the
  // pill: a fresh open should obviously snap to the latest content,
  // even if they had scrolled up before collapsing.
  useEffect(() => {
    if (open) stickToBottomRef.current = true;
  }, [open]);

  // Don't render anything if there's no reasoning yet AND we're not
  // currently thinking. This keeps the pill from appearing as a
  // dead "0 chars" stub for non-reasoning models.
  const hasContent = reasoning.trim().length > 0;
  if (!live && !hasContent) return null;

  // Some models thinking-stream a couple of tokens then immediately
  // answer — the `endedAtMs - startedAtMs` delta can be sub-100ms.
  // We still want to show *something*, so the floor for the frozen
  // label is "0.1s" rather than "0ms" (which reads like an error).
  const elapsedMs =
    startedAtMs !== null ? Math.max(0, (endedAtMs ?? Date.now()) - startedAtMs) : null;

  if (live) {
    frozenLabelRef.current = null;
  } else if (elapsedMs !== null && frozenLabelRef.current === null) {
    frozenLabelRef.current = formatDuration(elapsedMs);
  }

  return (
    <div
      className={cn('border-border/50 bg-fg/2 rounded-app-sm overflow-hidden border', className)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasContent}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10.5px] font-medium transition',
          hasContent ? 'text-fg-dim hover:bg-fg/5 cursor-pointer' : 'text-fg-dim/80 cursor-default',
        )}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform',
            open && 'rotate-90',
            !hasContent && 'opacity-30',
          )}
        />
        <Brain className={cn('h-3 w-3', live ? 'text-accent animate-pulse' : 'text-accent/60')} />
        {live ? (
          <span className="reasoning-shimmer">
            Thinking
            {elapsedMs !== null && elapsedMs >= 1000 ? `… ${formatDuration(elapsedMs)}` : '…'}
          </span>
        ) : (
          <span>
            {frozenLabelRef.current ? `Thought for ${frozenLabelRef.current}` : 'Reasoning'}
          </span>
        )}
        {hasContent && !live && (
          <span className="text-fg-dim/60 ml-auto font-mono text-[9.5px]">
            {reasoning.length.toLocaleString()} chars
          </span>
        )}
      </button>
      {open && hasContent && (
        <div
          ref={traceRef}
          onScroll={handleScroll}
          className={cn(
            // Compact peek window: ~120px shows roughly six or
            // seven lines — enough breathing room to follow a chain
            // of thought without it crowding out the actual answer
            // below. Anything longer scrolls inside the pill — the
            // trace stays in its lane.
            'reasoning-trace border-border/50 max-h-[120px] overflow-y-auto border-t',
            // The reasoning trace is "background context" — visually
            // recessed compared to the answer so the eye stays on
            // the response. Cursor / Codex use the same trick:
            // smaller text, deeply faded foreground, generous line
            // height. We apply opacity at the wrapper level so it
            // dims everything (bullets, bold, code, links) uniformly
            // — fighting it per-element with `text-fg/55` etc.
            // wasn't enough on dark backgrounds where 50% white still
            // reads as light gray.
            'text-fg-dim px-3 py-2 text-[11px] leading-[1.6] opacity-60',
            'border-l-accent/20 border-l-2',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Tighter spacing than the main answer renderer — the
              // trace is dense by nature, and the panel is small.
              p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-1.5 list-disc pl-4 last:mb-0">{children}</ul>,
              ol: ({ children }) => (
                <ol className="mb-1.5 list-decimal pl-4 last:mb-0">{children}</ol>
              ),
              li: ({ children }) => <li className="mb-0.5 last:mb-0">{children}</li>,
              h1: ({ children }) => (
                <div className="mt-1 mb-0.5 text-[11px] font-medium">{children}</div>
              ),
              h2: ({ children }) => (
                <div className="mt-1 mb-0.5 text-[11px] font-medium">{children}</div>
              ),
              h3: ({ children }) => (
                <div className="mt-1 mb-0.5 text-[11px] font-medium">{children}</div>
              ),
              // Inside a thought trace, "bold" is just emphasis —
              // medium weight (not heavy semibold) so it doesn't
              // compete with the actual answer below.
              strong: ({ children }) => <strong className="font-medium">{children}</strong>,
              em: ({ children }) => <em>{children}</em>,
              code: ({ className: cls, children }) => {
                const isInline = !cls;
                if (isInline) {
                  return (
                    <code className="bg-fg/10 rounded px-1 py-px font-mono text-[10px]">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="bg-fg/5 block rounded p-1.5 font-mono text-[10px] whitespace-pre-wrap">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-fg/5 mb-1.5 overflow-x-auto rounded p-1.5 text-[10px] last:mb-0">
                  {children}
                </pre>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {children}
                </a>
              ),
            }}
          >
            {reasoning}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    // Sub-second: show one decimal of seconds (Cursor convention),
    // floored at "0.1s" so the pill never reads as an error.
    const s = Math.max(0.1, ms / 1000);
    return `${s.toFixed(1)}s`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
