import { memo, useDeferredValue } from 'react';
import { AlertTriangle, Loader2, Scissors, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/cn';
import { ReasoningPill } from './ReasoningPill';
import { COMPACT_MARKDOWN_COMPONENTS } from './markdownComponents';
import { ActionHookButton } from './ActionHookButton';
import type { Turn } from './chatPanelTypes';

/**
 * Single chat turn renderer.
 *
 * Wrapped in `React.memo` because mid-stream the parent calls
 * `setTurns` on every delta — without memoisation, *every* historical
 * turn's `ReactMarkdown` re-parses on every keystroke-of-the-model.
 * That's the bulk of the "burası biraz donuyor" freeze the user
 * reported on long answers (200+ deltas × N turns × full markdown
 * AST rebuild).
 *
 * Memo's referential-equality comparison is enough here: the parent
 * mutates only the streaming turn's object reference (`.map` returns
 * a new object only for `t.id === targetTurnId`), so non-streaming
 * turns hand the same `turn` reference back next render and skip.
 *
 * The streaming turn DOES have to re-render — that's the whole
 * point — but we additionally route its content through
 * `useDeferredValue` so React can drop intermediate frames under
 * pressure and the markdown parser doesn't run on every single
 * 5-token delta.
 */
export const TurnView = memo(function TurnView({
  turn,
  onContinue,
}: {
  turn: Turn;
  /** Provided iff this turn was truncated by `max_tokens` AND it's
   *  the most recent assistant turn — see the call-site comment in
   *  `AiChatPanel` for the "last truncated only" rule. When set,
   *  the truncation banner renders a Continue button that resumes
   *  the answer in-place. */
  onContinue?: () => void;
}) {
  // Defer the markdown source for the streaming turn. React will
  // schedule the markdown re-render at a lower priority than user
  // interaction, so typing in the textarea or scrolling stays
  // responsive even while a 50-token-per-second model is firing
  // deltas at us. For non-streaming turns this is a no-op (the
  // value is already settled).
  const deferredContent = useDeferredValue(turn.content);

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-accent/10 text-fg/95 max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2 text-[12.5px] leading-snug wrap-break-word whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  // Compact model label shown next to the "RunHQ AI" header. We
  // prefer the model id (what the user actually picked in the
  // picker — "gpt-4o-mini", "glm-5.1") over the provider's display
  // name, falling back to the latter when the provider has no
  // explicit model. Truncated to keep multi-paragraph turn headers
  // single-line on the narrow chat panel.
  const modelLabel = turn.modelName || turn.providerName;

  return (
    <div className="flex flex-col gap-1">
      <div className="text-fg-dim flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.12em] uppercase">
        {turn.streaming ? (
          <Loader2 className="text-accent h-2.5 w-2.5 animate-spin" />
        ) : turn.error ? (
          <AlertTriangle className="text-status-error h-2.5 w-2.5" />
        ) : (
          <Sparkles className="text-accent h-2.5 w-2.5" />
        )}
        <span>RunHQ AI</span>
        {modelLabel && (
          <>
            <span className="text-fg-dim/40 font-normal tracking-normal normal-case" aria-hidden>
              ·
            </span>
            <span
              className="text-fg-dim/80 max-w-[180px] truncate font-mono text-[9.5px] font-normal tracking-normal normal-case"
              title={
                turn.providerName && turn.modelName
                  ? `${turn.providerName} · ${turn.modelName}`
                  : modelLabel
              }
            >
              {modelLabel}
            </span>
          </>
        )}
        {/*
         * "Incomplete" pill — fires whenever the assistant turn ends
         * in a non-clean state (cancellation, transport error, or any
         * future reason that doesn't already get a dedicated banner).
         * The `length` and `timeout` cases get their own actionable
         * banners below, so we suppress the pill there to avoid
         * piling redundant chrome on the same turn. For everything
         * else the pill is the single visible signal that this
         * answer didn't finish naturally — important once Phase 1
         * persists conversations and the user revisits an old chat
         * where they don't remember why a turn looks short.
         */}
        {turn.partial &&
          !turn.streaming &&
          !turn.error &&
          turn.finishReason !== 'length' &&
          turn.finishReason !== 'timeout' && (
            <>
              <span className="text-fg-dim/40 font-normal tracking-normal normal-case" aria-hidden>
                ·
              </span>
              <span
                className="border-status-starting/40 bg-status-starting/10 text-status-starting rounded-sm border px-1 py-px text-[9px] font-semibold tracking-normal normal-case"
                title="This answer ended before the model finished — it was cancelled or interrupted."
              >
                incomplete
              </span>
            </>
          )}
      </div>
      {!turn.error && (
        <ReasoningPill
          reasoning={turn.reasoning ?? ''}
          startedAtMs={turn.reasoningStartedAtMs ?? null}
          endedAtMs={turn.reasoningEndedAtMs ?? null}
        />
      )}
      {turn.error ? (
        <p className="text-status-error text-[11.5px] leading-snug wrap-break-word">{turn.error}</p>
      ) : (
        <div className="ai-answer-body text-fg/90 text-[12.5px] leading-[1.55] wrap-break-word">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPACT_MARKDOWN_COMPONENTS}>
            {deferredContent || (turn.streaming ? '…' : '')}
          </ReactMarkdown>
          {turn.streaming && (
            <span className="bg-accent ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle" />
          )}
        </div>
      )}

      {/* Truncation banner.
       *
       * Shows up under any non-streaming assistant turn whose stream
       * stopped because it hit `max_tokens` (`finish_reason === "length"`).
       * The button only appears on the *last* such turn — see the
       * call-site filter that decides whether to pass `onContinue`.
       *
       * Why this matters: before this banner, a truncated answer was
       * indistinguishable from "the model finished, that's just a
       * short answer". The user reported repeated mid-sentence
       * cutoffs ("yanıtlar yarıda kesiliyor abi"). Surfacing the
       * cause (and offering a one-click fix) is the only durable
       * solution — token budgets will always run out for some
       * combination of model, prompt, and reasoning depth.
       */}
      {!turn.streaming && !turn.error && turn.finishReason === 'length' && (
        <div
          className={cn(
            'border-status-starting/30 bg-status-starting/5 mt-1 flex items-center gap-2',
            'rounded-md border px-2.5 py-1.5 text-[11px]',
          )}
          role="status"
        >
          <Scissors className="text-status-starting h-3 w-3 shrink-0" />
          <span className="text-fg-dim flex-1 leading-snug">
            Response was cut off (max tokens reached). Increase{' '}
            <span className="text-fg/70 font-mono">max_output_tokens</span> in AI Settings, or:
          </span>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className={cn(
                'bg-accent text-accent-fg hover:bg-accent-hover',
                'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
              )}
            >
              Continue
            </button>
          )}
        </div>
      )}

      {/* Generic "incomplete" banner — fires for any non-streaming
       *  partial turn that doesn't already match the `length` or
       *  `timeout` cases above. Most common trigger: a local
       *  reasoning-heavy model emitted its full answer in the
       *  reasoning channel and only a fragment in the body, then
       *  closed cleanly with `finish_reason: stop`. Without a
       *  Continue affordance the user is stranded — the badge
       *  alone isn't actionable. */}
      {!turn.streaming &&
        !turn.error &&
        turn.partial &&
        turn.finishReason !== 'length' &&
        turn.finishReason !== 'timeout' && (
          <div
            className={cn(
              'border-status-starting/30 bg-status-starting/5 mt-1 flex items-center gap-2',
              'rounded-md border px-2.5 py-1.5 text-[11px]',
            )}
            role="status"
          >
            <AlertTriangle className="text-status-starting h-3 w-3 shrink-0" />
            <span className="text-fg-dim flex-1 leading-snug">
              Answer looks incomplete — the model may have stopped early or kept its reply in the
              reasoning trace.
            </span>
            {onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className={cn(
                  'bg-accent text-accent-fg hover:bg-accent-hover',
                  'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
                )}
                title="Ask the model to continue and place the final answer here"
              >
                Continue
              </button>
            )}
          </div>
        )}

      {/* Idle-timeout banner — synthesised by the Rust parser when
       *  the upstream went silent without sending `finish_reason`,
       *  `[DONE]`, or closing the TCP socket. Distinct copy from
       *  the truncation banner because the failure mode is
       *  different: there's nothing the user can do about token
       *  budgets here, the model itself (or its proxy) flatlined.
       *  Telling them to "increase max_output_tokens" would be
       *  actively misleading. */}
      {!turn.streaming && !turn.error && turn.finishReason === 'timeout' && (
        <div
          className={cn(
            'border-status-error/30 bg-status-error/5 mt-1 flex items-center gap-2',
            'rounded-md border px-2.5 py-1.5 text-[11px]',
          )}
          role="status"
        >
          <AlertTriangle className="text-status-error h-3 w-3 shrink-0" />
          <span className="text-fg-dim flex-1 leading-snug">
            Stream stalled — the model stopped sending tokens. This is usually a flaky upstream; try
            again or switch models.
          </span>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className={cn(
                'bg-accent text-accent-fg hover:bg-accent-hover',
                'rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
              )}
              title="Resume from where the stream stalled"
            >
              Continue
            </button>
          )}
        </div>
      )}

      {/* Surface action hook button.
       *
       * Renders only on completed, non-error assistant turns whose
       * action hook isn't `none`. We deliberately don't show it
       * while streaming — half a commit message is worse than
       * waiting another second, and the visual churn of the button
       * appearing/disappearing as the answer grows would be
       * distracting.
       *
       * The click dispatches a window-level event the originating
       * surface listens for. We don't auto-close the chat panel
       * after the action — the user might want to send a follow-up
       * ("make it shorter", "use imperative tense") and re-fire the
       * action with the refined version. The receiving surface is
       * responsible for any local UX (selecting its own input,
       * showing a "filled" toast, etc.).
       */}
      {!turn.streaming &&
        !turn.error &&
        turn.actionHook &&
        turn.actionHook.kind !== 'none' &&
        turn.content.trim().length > 0 && (
          <ActionHookButton hook={turn.actionHook} content={turn.content} />
        )}
    </div>
  );
});
