import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface MatchInfo {
  index: number;
  count: number;
}

interface Props {
  query: string;
  setQuery: (q: string) => void;
  matchInfo: MatchInfo | null;
  onStep: (direction: 'next' | 'prev') => void;
  onClose: () => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

/**
 * Floating search bar for the project DOCS renderer.
 *
 * Visual contract is intentionally identical to `LogXtermView`'s
 * search overlay (top-right floating chip, N/M counter, prev/next
 * chevrons, Esc-close X). Two instances open in different surfaces
 * should feel like the same control — a user who learned Cmd+F in
 * the LOGS pane shouldn't have to re-orient when they hit it in
 * DOCS.
 *
 * `data-docs-search-ui="true"` is read by the search engine's
 * `TreeWalker` filter so the placeholder / counter strings don't
 * show up as their own matches when the query happens to overlap
 * (e.g. searching for "find" should not paint the input's
 * "Find in docs…" placeholder).
 */
export function DocsSearchBar({
  query,
  setQuery,
  matchInfo,
  onStep,
  onClose,
  onInputKeyDown,
  inputRef,
}: Props) {
  return (
    <div
      data-docs-search-ui="true"
      className={cn(
        'border-border bg-surface-raised shadow-lg',
        'absolute top-2 right-3 z-20 flex items-center gap-1',
        'rounded-app-sm border px-1.5 py-1',
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Find in docs…"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          'border-border bg-surface-muted/70 text-fg placeholder:text-fg-dim',
          'focus:border-accent/60 focus:bg-surface',
          'rounded-app-sm h-6 w-48 border px-2 text-[12px] transition focus:outline-none',
        )}
      />
      <span
        className={cn(
          'text-fg-dim min-w-[44px] px-1 text-center font-mono text-[10.5px] tabular-nums',
          matchInfo === null && query !== '' && 'text-status-error',
        )}
      >
        {matchInfo ? `${matchInfo.index}/${matchInfo.count}` : query === '' ? '0/0' : 'no match'}
      </span>
      <button
        type="button"
        onClick={() => onStep('prev')}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onStep('next')}
        title="Next match (Enter)"
        aria-label="Next match"
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close search"
        className="text-fg-dim hover:bg-surface-overlay hover:text-fg flex h-5 w-5 items-center justify-center rounded transition"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
