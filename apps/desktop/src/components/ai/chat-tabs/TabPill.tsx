import { memo, type MouseEvent } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export const TabPill = memo(function TabPill({
  id,
  title,
  isActive,
  isStreaming,
  isContextTarget,
  onSelect,
  onClose,
  onContextMenu,
}: {
  id: string;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  /** True when this tab is the current context-menu target. We
   *  draw a soft ring around it so the user can see *which* tab
   *  the menu is operating on — important when right-clicking an
   *  inactive tab, where there'd otherwise be no visual link
   *  between the cursor and the popped menu. */
  isContextTarget: boolean;
  onSelect: (id: string) => void;
  onClose: (e: MouseEvent, id: string) => void;
  onContextMenu: (e: MouseEvent, id: string) => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onSelect(id)}
      onContextMenu={(e) => onContextMenu(e, id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(id);
        }
      }}
      // `group` so the close × can reveal on tab-hover even when
      // it's outside the textual hover area (the icon is small
      // enough that hover-targeting just it is fiddly).
      className={cn(
        'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md',
        'pr-1 pl-2 text-[11.5px] transition-colors select-none',
        // `flex-1 basis-0 min-w-0` lets every tab share the row
        // width equally and *truncate* instead of overflowing. We
        // cap at 160px so a single tab in a wide panel doesn't
        // sprawl across the strip, and floor at ~64px so the icon
        // + a few characters of title stay legible even at the
        // 5-tab cap on a narrow rail.
        'max-w-[160px] min-w-[64px] flex-1 basis-0',
        isActive
          ? 'bg-surface text-fg shadow-[0_1px_0_var(--color-border)]'
          : 'text-fg-dim hover:bg-fg/6 hover:text-fg/90',
        isContextTarget && 'ring-accent/40 ring-1',
      )}
    >
      {/* Tiny leading glyph: spinner during stream, accent dot for
       *  the active tab, sparkles for inactive tabs. Keeps each row
       *  scannable without leaning on colour alone. */}
      {isStreaming ? (
        <Loader2 className="text-accent h-3 w-3 shrink-0 animate-spin" />
      ) : isActive ? (
        <span aria-hidden className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />
      ) : (
        <Sparkles className="text-fg-dim/70 h-3 w-3 shrink-0" />
      )}
      <span
        className={cn(
          'truncate',
          // Reserve a hair of right-padding so the close × doesn't
          // overlap the last character of long titles when it
          // appears on hover.
          'pr-0.5',
        )}
        title={title}
      >
        {title}
      </span>
      <button
        type="button"
        onClick={(e) => onClose(e, id)}
        // The × is always rendered (so the layout doesn't jiggle on
        // hover) but only opacity-revealed on tab hover / focus —
        // matches VSCode's "modified-dot ↔ close" toggle pattern.
        className={cn(
          'ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded',
          'opacity-0 transition group-hover:opacity-100',
          'hover:bg-fg/15 focus:opacity-100 focus:outline-none',
          // Active tab: keep × visible at a softer opacity so the
          // user always has an obvious close target on the chat
          // they're actually looking at. Inactive tabs reveal on
          // hover.
          isActive && 'opacity-60',
        )}
        aria-label={`Close ${title}`}
        title="Close tab"
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
      {/* Active-tab underline. A 2px accent rule that sits *over*
       *  the 1px border-bottom of the bar, providing the "this is
       *  selected" cue. Pulled out as an absolute element so it
       *  doesn't perturb the flex layout. */}
      {isActive && (
        <span
          aria-hidden
          className="bg-accent absolute right-0 -bottom-1 left-0 h-[2px] rounded-t"
        />
      )}
    </div>
  );
});
