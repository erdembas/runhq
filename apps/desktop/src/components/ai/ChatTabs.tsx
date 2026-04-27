import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { MAX_OPEN_TABS } from '@/store/useAppStore';
import type { ConversationSummary } from '@/types';

/**
 * Cached lookup: conversation id → display label. We hydrate this
 * lazily by hitting `listConversations` whenever we see ids in
 * `openTabs` that we haven't titled yet. The cache is module-local
 * (not React state) so multiple ChatTabs mounts in the same session
 * share the same hits — the panel can remount across rail toggles
 * and we don't want to re-fetch on every open.
 */
const titleCache = new Map<string, string>();

/** Fallback label for tabs whose conversation row hasn't been
 *  fetched yet, or whose title came back empty. We don't want to
 *  flash the conversation id to the user, ever. */
const PLACEHOLDER_TITLE = 'New chat';

interface ChatTabsProps {
  openTabs: string[];
  activeConversationId: string | null;
  /** Provided by the panel: the live title of the active chat
   *  (e.g. derived from the user's first message before the
   *  conversation row exists yet). Lets us render an honest title
   *  on a fresh chat that hasn't been persisted yet. */
  activeTitleOverride?: string | null;
  /** True when the active tab has a streaming assistant turn. The
   *  parent owns this state — we just pulse a tiny spinner on the
   *  matching tab so a peripheral switch doesn't lose the thread. */
  activeStreaming?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Disable the "+" affordance when the parent knows a new chat
   *  would either overflow the cap (enforced anyway) or land on an
   *  already-empty fresh chat (which would be a no-op). Keeping the
   *  decision in the parent avoids duplicating "is the active chat
   *  empty?" logic across components. */
  newDisabled?: boolean;
}

/**
 * Cursor-style horizontal tab bar for the AI chat panel.
 *
 * Up to {@link MAX_OPEN_TABS} simultaneous chats; the active tab is
 * raised with a soft surface-fill + a thin accent underline. Inactive
 * tabs are flat and quiet so the bar doesn't visually compete with
 * the chat content. Each tab carries a hover-revealed × that closes
 * just that tab; closing the active one snaps to the neighbour
 * (handled by the store's `closeTab`).
 *
 * The "+" affordance trails the bar to seed a fresh chat slot. It
 * disappears once we hit the cap so users get a stable signal that
 * they need to close something before opening more.
 */
export const ChatTabs = memo(function ChatTabs({
  openTabs,
  activeConversationId,
  activeTitleOverride,
  activeStreaming,
  onSelect,
  onClose,
  onNew,
  newDisabled,
}: ChatTabsProps) {
  // Force a re-render when titleCache hydrates new entries. The
  // cache itself is a Map (mutated in place), so React doesn't
  // know to re-render on its own — bumping this counter does the
  // job without forcing every consumer to wire up a context.
  const [, setHydrationTick] = useState(0);
  const inflightRef = useRef<Set<string>>(new Set());

  // Lazy-fetch summaries for tabs we haven't titled yet. We hit
  // `listConversations` once and pull every missing id out of the
  // returned page; if the user has tons of conversations and the
  // tab isn't in the default page, we fall back to a per-id
  // `getConversation` (heavier, but rare).
  useEffect(() => {
    const missing = openTabs.filter((id) => !titleCache.has(id) && !inflightRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) inflightRef.current.add(id);

    let cancelled = false;
    void (async () => {
      try {
        const summaries = await ipc.listConversations({
          limit: 100,
          include_archived: true,
        });
        if (cancelled) return;
        const byId = new Map<string, ConversationSummary>(summaries.map((s) => [s.id, s]));
        let stillMissing = false;
        for (const id of missing) {
          const hit = byId.get(id);
          if (hit) {
            titleCache.set(id, normaliseTitle(hit.title));
            inflightRef.current.delete(id);
          } else {
            stillMissing = true;
          }
        }
        // Anything not in the first 100 rows: fall back to a
        // direct fetch. This is the long-tail case where the user
        // has a year-old archived chat pinned as a tab.
        if (stillMissing) {
          for (const id of missing) {
            if (titleCache.has(id)) continue;
            try {
              const conv = await ipc.getConversation(id);
              if (cancelled) return;
              titleCache.set(id, normaliseTitle(conv.title));
            } catch {
              // Conversation likely deleted out from under us.
              // Cache the placeholder so we don't spam retries;
              // the parent will hide the tab when the id ages out
              // of `openTabs`.
              titleCache.set(id, PLACEHOLDER_TITLE);
            } finally {
              inflightRef.current.delete(id);
            }
          }
        }
        setHydrationTick((t) => t + 1);
      } catch {
        // Network/IPC blip. Drop the in-flight markers so a
        // future render can retry; don't poison the cache.
        for (const id of missing) inflightRef.current.delete(id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openTabs]);

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onClose(id);
    },
    [onClose],
  );

  // Don't render the bar at all when there's nothing to switch
  // *to* — a single fresh chat shouldn't pay the chrome cost of a
  // tab strip. We still show the bar for a single persisted tab
  // so the user can spawn a second one via "+".
  if (openTabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Chat tabs"
      className={cn(
        // Stripe sits flush under the panel header. We use a 1px
        // bottom border (not just background contrast) so the
        // active tab's underline reads as an *override* of that
        // border rather than a free-floating mark.
        'border-border bg-surface-raised/60 flex items-center gap-0.5 border-b px-1.5 py-1',
        'overflow-x-auto',
        // Hide the scrollbar but keep horizontal overflow scrollable
        // (trackpad / shift-scroll). At 5-tab cap with 440px panel
        // width some tabs will still get tight; the user can drag
        // to reveal.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      {openTabs.map((id) => {
        const isActive = id === activeConversationId;
        const title =
          isActive && activeTitleOverride != null && activeTitleOverride !== ''
            ? activeTitleOverride
            : (titleCache.get(id) ?? PLACEHOLDER_TITLE);
        return (
          <TabPill
            key={id}
            id={id}
            title={title}
            isActive={isActive}
            isStreaming={Boolean(isActive && activeStreaming)}
            onSelect={onSelect}
            onClose={handleClose}
          />
        );
      })}
      <button
        type="button"
        onClick={onNew}
        disabled={newDisabled || openTabs.length >= MAX_OPEN_TABS}
        title={
          openTabs.length >= MAX_OPEN_TABS
            ? `Tab limit (${MAX_OPEN_TABS}) reached — close one to open more`
            : 'New chat'
        }
        aria-label="New chat tab"
        className={cn(
          'text-fg-dim hover:bg-fg/10 hover:text-fg ml-1 flex h-6 w-6 shrink-0 items-center',
          'justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-30',
          'disabled:hover:bg-transparent',
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
});

const TabPill = memo(function TabPill({
  id,
  title,
  isActive,
  isStreaming,
  onSelect,
  onClose,
}: {
  id: string;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: (id: string) => void;
  onClose: (e: React.MouseEvent, id: string) => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onSelect(id)}
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
        'group relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md',
        'pr-1 pl-2 text-[11.5px] transition-colors select-none',
        'max-w-[160px] min-w-[80px]',
        isActive
          ? 'bg-surface text-fg shadow-[0_1px_0_var(--color-border)]'
          : 'text-fg-dim hover:bg-fg/6 hover:text-fg/90',
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

function normaliseTitle(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (t.length === 0) return PLACEHOLDER_TITLE;
  // Strip surface prefix tags some `openAiChat` callers stuff into
  // the title (e.g. "Why · belgehub-backend"). Keeping them is
  // useful in History but cramps the tab bar. The first segment
  // before " · " is the surface; the rest is the meaningful label.
  // We display the meaningful part and lose the prefix.
  const sepIdx = t.indexOf(' · ');
  if (sepIdx > 0 && sepIdx < t.length - 3) {
    return t.slice(sepIdx + 3);
  }
  return t;
}
