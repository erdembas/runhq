import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

import { actionHookLabel, dispatchAiAction } from '@/lib/ai/actionHooks';
import { cn } from '@/lib/cn';
import type { AiActionHook } from '@/store/useAppStore';

/**
 * Primary CTA rendered below an assistant turn whose conversation
 * was opened from a non-chat surface (Commit, Standup, …). Kept as
 * its own component so the imports for `dispatchAiAction` /
 * `actionHookLabel` don't bloat the giant TurnView memo, and so the
 * "applied" feedback state can live in local state without forcing a
 * `TurnView` re-render on every click.
 */
export function ActionHookButton({ hook, content }: { hook: AiActionHook; content: string }) {
  const [applied, setApplied] = useState(false);
  const label = actionHookLabel(hook);
  if (!label) return null;
  const onClick = () => {
    const ok = dispatchAiAction(hook, content);
    if (!ok) return;
    setApplied(true);
    // Reset to the primary state after a beat — the user can re-run
    // the action against an edited follow-up turn, and showing a
    // permanent "Applied ✓" would imply the button is one-shot.
    window.setTimeout(() => setApplied(false), 1800);
  };
  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
          applied
            ? 'bg-status-success/15 text-status-success border-status-success/30 border'
            : 'bg-accent text-accent-fg hover:bg-accent-hover',
        )}
      >
        {applied ? (
          <>
            <Check className="h-3 w-3" />
            <span>Applied</span>
          </>
        ) : (
          <>
            <Sparkles className="h-3 w-3" />
            <span>{label}</span>
          </>
        )}
      </button>
    </div>
  );
}
