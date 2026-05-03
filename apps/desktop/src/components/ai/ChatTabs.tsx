import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsRight, ListX, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { MAX_OPEN_TABS } from '@/store/useAppStore';
import type { ConversationSummary } from '@/types';
import { FileContextMenu, type FileContextMenuEntry } from '@/components/ui/FileContextMenu';
import { TabPill } from '@/components/ai/chat-tabs/TabPill';

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
  /** Set of conversation ids (active OR background) that currently
   *  have a live stream running. Lets a tab the user navigated away
   *  from still advertise "I'm thinking" with a spinner, so a peek
   *  back to the rail tells them everything in flight at a glance —
   *  this is the visible counterpart of the "tab streams keep
   *  running on switch" fix.
   *
   *  Optional: callers that don't care about background streams can
   *  omit it and rely on `activeStreaming` for the active tab only. */
  streamingTabIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Bulk close: every tab except the right-clicked one. The
   *  right-clicked tab becomes active. */
  onCloseOthers: (keepId: string) => void;
  /** Bulk close: every tab to the right of the right-clicked one.
   *  Tabs to the left + the right-clicked tab itself stay open. */
  onCloseToRight: (id: string) => void;
  /** Bulk close: every tab. Active conversation becomes null and
   *  the panel falls back to its empty/welcome state. */
  onCloseAll: () => void;
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
  streamingTabIds,
  onSelect,
  onClose,
  onNew,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  newDisabled,
}: ChatTabsProps) {
  // Force a re-render when titleCache hydrates new entries. The
  // cache itself is a Map (mutated in place), so React doesn't
  // know to re-render on its own — bumping this counter does the
  // job without forcing every consumer to wire up a context.
  const [, setHydrationTick] = useState(0);
  const inflightRef = useRef<Set<string>>(new Set());

  // Right-click context menu state. The id is the tab the user
  // right-clicked (the *target* of the menu's actions, not
  // necessarily the active tab). We keep it in component state so
  // a single open menu cleanly overlays the rail and disables
  // itself on Esc / click-outside via FileContextMenu's handlers.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    // Prevent the default (Tauri/macOS) WebView context menu from
    // popping in over our rail — without this the user gets the
    // OS-level "Reload / Inspect Element" menu instead of our
    // tab-aware one.
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  }, []);

  // Don't render the bar at all when there's nothing to switch
  // *to* — a single fresh chat shouldn't pay the chrome cost of a
  // tab strip. We still show the bar for a single persisted tab
  // so the user can spawn a second one via "+".
  if (openTabs.length === 0) return null;

  // Build the context-menu entries lazily, gated on the
  // right-clicked tab's position. "Close Others" / "Close to the
  // Right" / "Close All" disable themselves when they'd be no-ops
  // — keeps the menu honest instead of letting the user click into
  // dead options.
  const menuItems: FileContextMenuEntry[] | null = (() => {
    if (!menu) return null;
    const idx = openTabs.indexOf(menu.id);
    if (idx < 0) return null;
    const total = openTabs.length;
    const tabsToRight = total - idx - 1;
    return [
      {
        id: 'close',
        label: 'Close',
        icon: <X size={12} />,
        onClick: () => onClose(menu.id),
      },
      {
        id: 'close-others',
        label: 'Close Others',
        icon: <ListX size={12} />,
        disabled: total <= 1,
        onClick: () => onCloseOthers(menu.id),
      },
      {
        id: 'close-to-right',
        label: 'Close to the Right',
        icon: <ChevronsRight size={12} />,
        disabled: tabsToRight === 0,
        hint: tabsToRight > 0 ? String(tabsToRight) : undefined,
        onClick: () => onCloseToRight(menu.id),
      },
      { id: 'sep-1', separator: true },
      {
        id: 'close-all',
        label: 'Close All',
        icon: <Trash2 size={12} />,
        tone: 'danger',
        onClick: () => onCloseAll(),
        hint: String(total),
      },
    ];
  })();

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
        // No horizontal scroll: tabs share the available row via
        // flex-grow so they always fit. Earlier we used overflow-x
        // + a hard min-width, which triggered macOS's auto-hiding
        // scrollbar gutter the moment the panel was narrower than
        // 5 × min-width — looked dirty above the strip. With 5 as
        // the open-tab cap and a sensible per-tab basis the row
        // always fits in the rail (and titles truncate gracefully
        // when crowded), so we just clip overflow to be safe.
        'overflow-hidden',
      )}
    >
      {openTabs.map((id) => {
        const isActive = id === activeConversationId;
        const title =
          isActive && activeTitleOverride != null && activeTitleOverride !== ''
            ? activeTitleOverride
            : (titleCache.get(id) ?? PLACEHOLDER_TITLE);
        // Streaming on the *active* tab is a fast in-render boolean
        // the panel already exposes; for *inactive* tabs we read
        // from the streamingTabIds set (populated from the panel's
        // turnsByConv map). This is what makes the spinner stick on
        // tab A while the user looks at tab B.
        const tabStreaming = isActive
          ? Boolean(activeStreaming)
          : Boolean(streamingTabIds?.has(id));
        return (
          <TabPill
            key={id}
            id={id}
            title={title}
            isActive={isActive}
            isStreaming={tabStreaming}
            isContextTarget={menu?.id === id}
            onSelect={onSelect}
            onClose={handleClose}
            onContextMenu={handleContextMenu}
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
      {menu && menuItems && (
        <FileContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
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
