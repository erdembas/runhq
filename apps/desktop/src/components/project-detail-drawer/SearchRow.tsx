import type { RefObject } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export function SearchRow({
  searchRef,
  query,
  setQuery,
  placeholder,
  shown,
  total,
  selectedCount,
  onSelectAll,
  onClearSelection,
  onAskAi,
  askAiLabel,
  askAiDisabled,
  askAiActive,
  askAiTriggerRef,
}: {
  searchRef: RefObject<HTMLInputElement>;
  query: string;
  setQuery: (v: string) => void;
  placeholder: string;
  shown: number;
  total: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Optional "Ask AI" affordance. When supplied, a small Sparkles
   *  pill is rendered on the right side of the meta row. Kept opt-in
   *  so the Outdated tab can stay AI-free for now and only the
   *  Advisories tab — where triage really helps — surfaces it. */
  onAskAi?: () => void;
  askAiLabel?: string;
  askAiDisabled?: boolean;
  askAiActive?: boolean;
  /** Anchor for the surface-side model chooser popover (see
   *  `useAiSurfaceTrigger`). Forwarded to the Ask AI button so the
   *  popover floats below the actual trigger element. The parent
   *  also renders the matching `popover` JSX (portaled to body). */
  askAiTriggerRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="border-border/60 bg-surface shrink-0 border-b px-3 py-2">
      <div className="border-border focus-within:border-accent/60 bg-surface flex items-center gap-1.5 rounded-md border px-2">
        <Search size={12} className="text-fg/40" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="text-fg placeholder:text-fg/30 w-full bg-transparent py-1.5 text-[11px] focus:outline-none"
          aria-label="Filter packages"
        />
        <kbd className="text-fg/35 border-border hidden rounded border px-1 font-mono text-[9px] sm:inline-block">
          /
        </kbd>
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-fg/30 hover:text-fg"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className="text-fg/40 tabular-nums">
          {shown === total ? `${total} total` : `${shown} of ${total}`}
        </span>
        <div className="flex items-center gap-2.5">
          {onAskAi && (
            <button
              ref={askAiTriggerRef}
              type="button"
              onClick={onAskAi}
              disabled={askAiDisabled}
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition',
                'border-accent/30 hover:border-accent/60 border',
                askAiActive
                  ? 'bg-accent/15 text-accent'
                  : 'bg-accent/5 text-accent/85 hover:bg-accent/10 hover:text-accent',
                askAiDisabled && 'hover:bg-accent/5 cursor-not-allowed opacity-50',
              )}
              title={
                askAiDisabled
                  ? 'Nothing to triage — adjust filters or run a scan first.'
                  : askAiActive
                    ? 'Hide the AI triage panel'
                    : 'Ask the AI to rank and recommend a fix order for the visible advisories'
              }
              aria-pressed={askAiActive ?? false}
            >
              <Sparkles size={10} />
              <span className="font-medium">{askAiLabel ?? 'Ask AI'}</span>
            </button>
          )}
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-fg/55 hover:text-fg transition"
            >
              Clear selection
            </button>
          ) : (
            shown > 0 && (
              <button
                type="button"
                onClick={onSelectAll}
                className="text-fg/55 hover:text-fg transition"
              >
                Select all visible
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
