import { Activity, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

interface Props {
  className?: string;
}

/**
 * Skinny rail glued to the right edge of the dashboard. Surfaces the
 * AI / activity affordances. Read-only on the marketing surface; the
 * real desktop opens drawers when these are clicked.
 */
export function RightActivityRail({ className }: Props) {
  return (
    <aside
      className={cn(
        'border-border bg-surface text-fg-dim flex w-9 shrink-0 flex-col items-center gap-3 border-l py-3',
        className,
      )}
    >
      <button
        type="button"
        className="hover:text-fg hover:bg-surface-muted rounded-md p-1.5 transition"
        aria-label="Activity"
      >
        <Activity className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="hover:text-fg hover:bg-surface-muted rounded-md p-1.5 transition"
        aria-label="AI"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    </aside>
  );
}
