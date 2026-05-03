import { memo, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { Search, X } from 'lucide-react';

import { Kbd } from '@/components/ui/Kbd';
import { cn } from '@/lib/cn';

/**
 * Wrapper that shows or hides a ServiceCard via CSS only.
 *
 * Critical that this is `display: contents` (not, say, a div with
 * `display: block`) when visible — the parent grid container relies
 * on the card being a *direct* grid item to size it. A wrapper that
 * participates in layout would collapse every card to a single column
 * regardless of the grid template. With `contents`, the wrapper has
 * no box of its own; the ServiceCard stays the grid item.
 *
 * On hide, `display: none` removes the entire subtree from layout
 * AND from accessibility/tab order — exactly what we want for a
 * filtered-out card. The card stays mounted (so its Zustand
 * subscriptions, AI hooks, and SVG sparklines don't tear down and
 * re-set up on every keystroke), but is invisible and inert.
 *
 * Memoized so toggling sibling cards doesn't churn this one.
 */
export const CardSearchSlot = memo(function CardSearchSlot({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return <div style={hidden ? CARD_SLOT_HIDDEN : CARD_SLOT_VISIBLE}>{children}</div>;
});
const CARD_SLOT_HIDDEN: CSSProperties = { display: 'none' };
const CARD_SLOT_VISIBLE: CSSProperties = { display: 'contents' };

/**
 * Search box, isolated from Dashboard's render tree.
 *
 * Two-layer setup:
 *
 *   1. Local `text` state owns the live keystroke. The bar's own
 *      input element is the only thing that re-renders per keystroke
 *      — Dashboard's enormous subtree (header, hero, attention
 *      banners, filter chips, group sections, every ServiceCard) is
 *      *never* re-rendered just to repaint the textbox.
 *
 *   2. `onCommit` propagates the query up to Dashboard inside a
 *      `useTransition` boundary. That marks Dashboard's resulting
 *      re-render as non-urgent: React keeps the textbox responsive
 *      (urgent updates always preempt transitions) and folds rapid
 *      keystrokes into a single committed value. Note this is NOT a
 *      debounce — there's no setTimeout, no wall-clock delay. The
 *      commit happens as fast as React can schedule it given the
 *      input thread's pressure. On a quiet main thread it's
 *      effectively synchronous; under typing burst it back-pressures
 *      naturally.
 *
 * Why no debounce: with the dashboard's mount roster decoupled from
 * search (cards stay mounted, search toggles `display`), the cost of
 * a search update is just a Set rebuild + a comparator pass + a
 * style toggle on each card wrapper. That's microseconds for a
 * realistic roster, well below any debounce window worth waiting
 * for. Adding a debounce now would only add perceived latency.
 *
 * Cards that don't match the active query render `display: none`
 * inside `CardSearchSlot`, so the DOM stays steady and only the
 * wrapper styles change between renders.
 */
/**
 * Tiny `<label>+<dropdown>` shell used by the Attention/Git filter
 * triggers in the dashboard toolbar.
 *
 * The label is a 7-px-uppercase chip glued to the dropdown's left
 * edge — same height, same border, no gap — so the pair reads as a
 * single *labeled* control rather than two adjacent chips. Without
 * this label the two `All (n)` triggers would look interchangeable
 * with each other AND with the Group / Sort dropdowns to their
 * right; "ATTENTION" / "GIT" gives the eye an immediate disambiguator.
 *
 * The child Select must compose its className with
 * `rounded-l-none border-l-0` so the right side of the chip
 * morphs cleanly into the dropdown trigger — that styling lives at
 * the call-site, not here, because only the call-site knows
 * whether the active-filter accent ring is also in play.
 *
 * `active` lights the label up in accent so the user can spot a
 * filtered axis even when the dropdown is collapsed; matches the
 * accent treatment the trigger itself gets when the filter is
 * pinned to a non-default value.
 */
export function LabeledFilterDropdown({
  label,
  active,
  children,
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="inline-flex items-center">
      <span
        className={cn(
          'border-border/50 bg-surface-muted text-fg-dim inline-flex h-7 items-center rounded-l-md border px-2 text-[9px] font-semibold tracking-wider uppercase transition',
          active && 'border-accent/50 bg-accent/10 text-accent',
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export const DashboardSearchBar = memo(function DashboardSearchBar({
  inputRef,
  onCommit,
}: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onCommit: (q: string) => void;
}) {
  const [text, setText] = useState('');
  const [, startTransition] = useTransition();
  const trimmedQuery = text.trim();

  // Stable ref to the latest `onCommit` so the commit handler doesn't
  // re-bind whenever the parent passes a fresh closure (defensive —
  // setState identity is already stable, but useEffect deps love
  // pretending otherwise).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const handleChange = useCallback(
    (next: string) => {
      // Urgent: keep the textbox in sync with the keystroke. Skipping
      // setState here would make the input feel laggy regardless of
      // how fast the rest of the pipeline runs.
      setText(next);
      // Non-urgent: propagate to Dashboard inside a transition. React
      // is free to delay this re-render if more keystrokes arrive
      // first, and the textbox stays responsive throughout.
      startTransition(() => {
        onCommitRef.current(next.trim());
      });
    },
    [startTransition],
  );

  const clear = useCallback(() => {
    setText('');
    startTransition(() => {
      onCommitRef.current('');
    });
    inputRef.current?.focus();
  }, [inputRef, startTransition]);

  return (
    <div
      className={cn(
        'border-border bg-surface-raised rounded-app-sm group relative flex h-7 items-center gap-1.5 border px-2.5 transition',
        'focus-within:border-fg-dim/45',
        trimmedQuery !== '' && 'border-fg-dim/35',
      )}
    >
      <Search
        className={cn(
          'h-3 w-3 shrink-0 transition',
          trimmedQuery === '' ? 'text-fg-dim' : 'text-fg-muted',
        )}
      />
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (text) {
              handleChange('');
            } else {
              e.currentTarget.blur();
            }
          }
        }}
        placeholder="Search projects"
        aria-label="Search projects"
        // The global `*:focus-visible` rule in styles.css paints an
        // orange accent ring on every focusable element. That ring
        // would stack inside the wrapper's `focus-within:` border and
        // read as a "border within a border".
        // `.dashboard-search-input` (defined alongside
        // `.qa-search-input` / `.history-search-input` in styles.css)
        // overrides the universal rule on specificity; the Tailwind
        // `outline-none` is kept as a belt-and-braces fallback for
        // non-`focus-visible` focus states.
        className="dashboard-search-input placeholder:text-fg-dim/70 text-fg w-44 border-none bg-transparent text-[12px] outline-none"
        spellCheck={false}
        autoComplete="off"
      />
      {trimmedQuery !== '' ? (
        <button
          type="button"
          onClick={clear}
          title="Clear search (Esc)"
          aria-label="Clear search"
          className="text-fg-dim hover:text-fg -mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <Kbd className="border-border/60 text-fg-dim/80 bg-surface-overlay/60 h-4 px-1 text-[9.5px]">
          /
        </Kbd>
      )}
    </div>
  );
});
