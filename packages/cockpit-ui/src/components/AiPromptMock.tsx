import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

interface Props {
  /** The user's prompt — rendered with the `>` shell-style caret. */
  prompt: string;
  /** The model's response. ReactNode so callers can mark up bold
   *  spans, code, etc. */
  answer: ReactNode;
  /** Footer cluster — typically `model name` on the left and a
   *  `tokens` counter on the right. Both are optional. */
  model?: string;
  tokens?: string;
  /** Whether to render the blinking caret at the end of the answer
   *  (the visual hint that "the model is still typing"). On by
   *  default — disable for static screenshots. */
  caret?: boolean;
  /** Compact mode shrinks every padding / font-size for use inside
   *  small marketing cards (≤ 280px wide). */
  compact?: boolean;
  className?: string;
}

/**
 * Marketing-grade AI prompt + answer mock.
 *
 * Lives in cockpit-ui (not in apps/site) because three different
 * marketing surfaces render this same shape:
 *   - <WhySection /> card 3 ("AI difference")
 *   - <FeaturesSection /> card 4 ("Think")
 *   - <LoopSection /> tab 3 ("Triage")
 *
 * Centralising the chrome (border, prompt caret, sparkles, blinking
 * cursor, model + tokens footer) means a copy edit in one place
 * propagates to every demo block at once. The primitive does *no*
 * IPC, network, or model orchestration — it's a presentational
 * composition of `<Sparkles />` + a paragraph + a footer row.
 *
 * Visual contract:
 *   - Mono font throughout — matches the `font-mono` log + terminal
 *     primitives elsewhere in the cockpit, so the eye reads "this
 *     is machine output", not marketing copy.
 *   - The sparkle icon uses `text-accent` from the theme tokens, so
 *     a host-app theme change automatically restyles the AI marker.
 *   - `motion-safe:animate-pulse` respects
 *     `prefers-reduced-motion` — the blinking caret only animates
 *     for visitors who haven't asked the OS to dial back motion.
 */
export function AiPromptMock({
  prompt,
  answer,
  model,
  tokens,
  caret = true,
  compact = false,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'border-border bg-surface flex flex-col gap-1.5 rounded-lg border font-mono',
        compact ? 'p-3 text-[10.5px]' : 'p-3 text-[11.5px]',
        className,
      )}
    >
      <span className="text-fg-dim">&gt; {prompt}</span>
      <span className="text-fg flex items-baseline gap-1">
        <Sparkles
          className={cn('text-accent shrink-0', compact ? 'h-3 w-3' : 'h-3 w-3')}
          aria-hidden
        />
        <span className="leading-relaxed">
          {answer}
          {caret && (
            <span
              aria-hidden
              className={cn(
                'bg-accent ml-0.5 inline-block w-1 align-[-2px] motion-safe:animate-pulse',
                compact ? 'h-2.5' : 'h-3',
              )}
            />
          )}
        </span>
      </span>
      {(model || tokens) && (
        <div
          className={cn(
            'text-fg-dim/70 mt-0.5 flex items-center gap-2',
            compact ? 'text-[9.5px]' : 'text-[10px]',
          )}
        >
          {model && <span>{model}</span>}
          {tokens && <span className="ml-auto tabular-nums">{tokens}</span>}
        </div>
      )}
    </div>
  );
}
