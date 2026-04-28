import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  FileSearch,
  GitBranch,
  Globe,
  Inbox,
  ListChecks,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  ScrollText,
  Search,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type { ConversationSummary } from '@/types';

/**
 * Right-side history drawer for the AI Chat panel.
 *
 * Lists every conversation persisted to SQLite, grouped by recency
 * (Pinned / Favorites / Today / Yesterday / Older). Each row shows
 * the origin icon, the title, a one-line preview of the last message,
 * a star toggle, and the relative time stamp. Right-clicking a row
 * opens a small menu with rename / pin / favorite / archive / delete
 * actions.
 *
 * Lives in its own file rather than inline inside `AiChatPanel.tsx`
 * because the chat panel is already 1500 lines; keeping the drawer
 * here keeps the diff for the multi-conversation refactor reviewable.
 *
 * Visual contract:
 *   - Slides in over the chat panel (z-index above the panel, below
 *     global modals). Click outside / Esc closes.
 *   - Active conversation is highlighted with the accent colour.
 *   - Pinned conversations sit at the top under a "Pinned" header,
 *     followed by Favorites, then time-bucketed groups.
 *   - Archived conversations are hidden by default; a footer toggle
 *     reveals them.
 *   - A search input at the top filters by title or message content
 *     (server-side LIKE). When a query is active, time groupings
 *     collapse into a single flat "Results" list because grouping a
 *     6-row search hit by Today/Yesterday/Older is more noise than
 *     signal.
 */
export interface HistoryDrawerProps {
  open: boolean;
  activeConversationId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function HistoryDrawer({
  open,
  activeConversationId,
  onClose,
  onSelect,
}: HistoryDrawerProps) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Two state slices so the input stays responsive: `query` is what
  // the user sees in the textbox, `appliedQuery` is what we last
  // shipped to the backend. A 180 ms debounce reconciles them so we
  // don't fire an IPC call per keystroke.
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
    pinned: boolean;
    favorite: boolean;
    archived: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Debounce search input -> backend query. We trim before comparing
  // so leading/trailing spaces don't trigger redundant reloads, but
  // ship the trimmed value as-is (backend treats whitespace-only as
  // no filter anyway).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === appliedQuery) return;
    const id = setTimeout(() => setAppliedQuery(trimmed), 180);
    return () => clearTimeout(id);
  }, [query, appliedQuery]);

  /**
   * Refresh the list from IPC. Called on open, after every mutation
   * (rename/pin/favorite/archive/delete), when the user toggles
   * archived/favorites filters, and whenever the debounced search
   * query changes. We deliberately re-fetch from scratch rather than
   * mutating the local array — the backend's pin > favorite > recency
   * sort is opinionated and we'd otherwise have to re-implement it
   * client-side.
   */
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ipc.listConversations({
        limit: 500,
        include_archived: includeArchived,
        favorites_only: favoritesOnly,
        query: appliedQuery || null,
      });
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [includeArchived, favoritesOnly, appliedQuery]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  // Auto-focus the search box when the drawer opens — most users hit
  // history with intent ("where was that diff convo from yesterday?").
  // Slight defer so the focus doesn't get clobbered by the parent's
  // own focus management.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(id);
  }, [open]);

  // Esc to close. We attach the listener only while open so it
  // doesn't fight the chat panel's own Esc handler in drawer mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Close the context menu first, then renaming, then clear an
        // active search, then close the drawer — same priority as
        // any layered overlay. This means a user with an open menu +
        // search active hits Esc three times to fully back out, which
        // matches Slack/Linear/VSCode behaviour.
        if (menu) setMenu(null);
        else if (renaming) setRenaming(null);
        else if (query) {
          setQuery('');
          setAppliedQuery('');
        } else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, menu, renaming, query]);

  // Click-outside-the-drawer dismisses. We don't add a backdrop
  // because the chat panel underneath should still be visible —
  // the drawer is supposed to feel like a sidebar, not a modal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node || !(e.target instanceof Node)) return;
      if (node.contains(e.target)) return;
      onClose();
    };
    // `mouseup` not `mousedown` — otherwise a drag-to-select inside
    // the drawer that drifts onto the chat panel would close it.
    window.addEventListener('mouseup', onDown);
    return () => window.removeEventListener('mouseup', onDown);
  }, [open, onClose]);

  /**
   * Group rows into Pinned / Favorites / Today / Yesterday / Older.
   * Order inside groups follows the backend's `ORDER BY pinned DESC,
   * favorite DESC, updated_at_ms DESC`.
   *
   * When a search is active OR the favorites-only filter is on, we
   * skip grouping entirely — both modes are inherently flat and the
   * date buckets just add visual noise to a tiny result set.
   */
  const groups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    const pinned: ConversationSummary[] = [];
    const favorites: ConversationSummary[] = [];
    const today: ConversationSummary[] = [];
    const yesterday: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];
    for (const it of items) {
      if (it.pinned) {
        // Pinned wins regardless of favorite — same row should only
        // appear once in the drawer or the user wonders if there are
        // duplicates. Pin is the stronger signal.
        pinned.push(it);
        continue;
      }
      if (it.favorite) {
        favorites.push(it);
        continue;
      }
      if (it.updated_at_ms >= startOfToday) today.push(it);
      else if (it.updated_at_ms >= startOfYesterday) yesterday.push(it);
      else older.push(it);
    }
    return { pinned, favorites, today, yesterday, older };
  }, [items]);

  const isFlatMode = appliedQuery.length > 0 || favoritesOnly;

  const onContextMenu = useCallback((e: React.MouseEvent, item: ConversationSummary) => {
    e.preventDefault();
    // Clamp X so the menu doesn't overflow the right edge of the
    // viewport — drawer is 320px wide right-anchored, naive
    // `clientX` puts the menu past the screen on the rightmost
    // 200px.
    const maxX = window.innerWidth - 200;
    setMenu({
      id: item.id,
      x: Math.min(e.clientX, maxX),
      y: e.clientY,
      pinned: item.pinned,
      favorite: item.favorite,
      archived: item.archived,
    });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onRename = useCallback((item: ConversationSummary) => {
    setMenu(null);
    setRenaming({ id: item.id, value: item.title });
  }, []);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const v = renaming.value.trim();
    if (!v) {
      setRenaming(null);
      return;
    }
    try {
      await ipc.renameConversation(renaming.id, v);
    } catch (e) {
      console.error('rename failed', e);
    }
    setRenaming(null);
    void reload();
  }, [renaming, reload]);

  const onPin = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
      try {
        await ipc.pinConversation(item.id, !item.pinned);
      } catch (e) {
        console.error('pin failed', e);
      }
      void reload();
    },
    [reload],
  );

  /**
   * Toggle favorite on a conversation. Optimistic update so the
   * star animates instantly even on a cold IPC; we re-fetch to
   * reconcile the canonical sort order from the backend (a newly
   * starred row may need to float above non-starred ones).
   */
  const onFavorite = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
      const next = !item.favorite;
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: next } : it)));
      try {
        await ipc.favoriteConversation(item.id, next);
      } catch (e) {
        console.error('favorite failed', e);
        // Revert optimistic flip on failure.
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: !next } : it)));
        return;
      }
      void reload();
    },
    [reload],
  );

  const onArchive = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
      try {
        await ipc.archiveConversation(item.id, !item.archived);
      } catch (e) {
        console.error('archive failed', e);
      }
      void reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
      // SQLite cascades the messages — the row vanishes for good.
      // We don't soft-delete because archived already covers the
      // "I might want this back" case; explicit delete = explicit
      // delete.
      const confirmed = window.confirm(
        `Delete "${item.title.slice(0, 40)}"? This cannot be undone.`,
      );
      if (!confirmed) return;
      try {
        await ipc.deleteConversation(item.id);
      } catch (e) {
        console.error('delete failed', e);
      }
      void reload();
    },
    [reload],
  );

  if (!open) return null;

  const hasActiveFilters = favoritesOnly || appliedQuery.length > 0;

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'absolute top-0 right-0 bottom-0 z-30 flex w-[320px] flex-col',
          'bg-surface-raised border-border/70 border-l shadow-xl',
        )}
        role="dialog"
        aria-label="Chat history"
      >
        <header className="border-border/60 flex items-center gap-2 border-b px-3 py-2">
          <ScrollText className="text-fg-dim h-3.5 w-3.5" />
          <div className="text-fg text-[12px] font-semibold">Chat history</div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="text-fg-dim hover:bg-fg/10 hover:text-fg flex h-6 w-6 items-center justify-center rounded transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Search + filters. Sits below the header so it stays sticky
            while the list scrolls underneath. */}
        <div className="border-border/60 flex flex-col gap-1.5 border-b px-2.5 py-2">
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1',
              'bg-fg/5 border-border/40 border',
              // No accent border swap on focus — kullanıcı turuncu
              // halo istemedi. Caret + placeholder'ın fade'i + hafif
              // bg ton kayması focus affordance'ı için yeterli.
              'focus-within:bg-fg/[0.07]',
              'transition-colors',
            )}
          >
            <Search className="text-fg-dim h-3 w-3 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or messages…"
              aria-label="Search conversations"
              // `history-search-input` neutralises the global
              // `*:focus-visible { outline: accent }` rule defined
              // in styles.css. Tailwind utilities can't reach it
              // (specificity bug — universal selector + pseudo wins
              // over Tailwind's `focus:outline-none`), so we go
              // through a class-based override that lives next to
              // the global rule.
              className={cn(
                'history-search-input',
                'text-fg placeholder:text-fg-dim/70 min-w-0 flex-1 bg-transparent text-[11.5px]',
                'border-0 ring-0 outline-none focus:ring-0 focus:outline-none',
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setAppliedQuery('');
                  searchInputRef.current?.focus();
                }}
                title="Clear search"
                className="text-fg-dim hover:text-fg flex h-4 w-4 items-center justify-center rounded transition"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <FilterChip
              active={!favoritesOnly}
              onClick={() => setFavoritesOnly(false)}
              label="All"
            />
            <FilterChip
              active={favoritesOnly}
              onClick={() => setFavoritesOnly(true)}
              icon={<Star className="h-2.5 w-2.5" fill={favoritesOnly ? 'currentColor' : 'none'} />}
              label="Favorites"
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setFavoritesOnly(false);
                  setQuery('');
                  setAppliedQuery('');
                }}
                className="text-fg-dim hover:text-fg ml-auto rounded px-1.5 py-0.5 text-[10px] transition"
                title="Clear all filters"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="border-status-error/30 bg-status-error/5 text-status-error border-b px-3 py-2 text-[11px]">
              {error}
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="text-fg-dim flex items-center gap-2 px-3 py-4 text-[11px]">
              <span className="bg-fg-dim/40 h-2 w-2 animate-pulse rounded-full" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              hasQuery={appliedQuery.length > 0}
              favoritesOnly={favoritesOnly}
              query={appliedQuery}
            />
          ) : isFlatMode ? (
            // Flat result list — same row component, but no group
            // dividers since "Today" / "Older" mean very little when
            // the user has filtered down to 6 hits.
            <Group
              label={appliedQuery ? `Results for "${truncate(appliedQuery, 20)}"` : 'Favorites'}
              items={items}
              activeId={activeConversationId}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onToggleFavorite={onFavorite}
              renaming={renaming}
              setRenaming={setRenaming}
              onCommitRename={commitRename}
            />
          ) : (
            <>
              <Group
                label="Pinned"
                items={groups.pinned}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleFavorite={onFavorite}
                renaming={renaming}
                setRenaming={setRenaming}
                onCommitRename={commitRename}
              />
              <Group
                label="Favorites"
                items={groups.favorites}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleFavorite={onFavorite}
                renaming={renaming}
                setRenaming={setRenaming}
                onCommitRename={commitRename}
              />
              <Group
                label="Today"
                items={groups.today}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleFavorite={onFavorite}
                renaming={renaming}
                setRenaming={setRenaming}
                onCommitRename={commitRename}
              />
              <Group
                label="Yesterday"
                items={groups.yesterday}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleFavorite={onFavorite}
                renaming={renaming}
                setRenaming={setRenaming}
                onCommitRename={commitRename}
              />
              <Group
                label="Older"
                items={groups.older}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleFavorite={onFavorite}
                renaming={renaming}
                setRenaming={setRenaming}
                onCommitRename={commitRename}
              />
            </>
          )}
        </div>

        <footer className="border-border/60 flex items-center gap-2 border-t px-3 py-1.5 text-[10.5px]">
          <label className="text-fg-dim hover:text-fg flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-3 w-3"
            />
            Show archived
          </label>
          {items.length > 0 && (
            <span className="text-fg-dim/60 ml-auto">
              {items.length} {items.length === 1 ? 'chat' : 'chats'}
            </span>
          )}
        </footer>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          pinned={menu.pinned}
          favorite={menu.favorite}
          archived={menu.archived}
          onClose={closeMenu}
          onRename={() => {
            const item = items.find((it) => it.id === menu.id);
            if (item) onRename(item);
          }}
          onPin={() => {
            const item = items.find((it) => it.id === menu.id);
            if (item) void onPin(item);
          }}
          onFavorite={() => {
            const item = items.find((it) => it.id === menu.id);
            if (item) void onFavorite(item);
          }}
          onArchive={() => {
            const item = items.find((it) => it.id === menu.id);
            if (item) void onArchive(item);
          }}
          onDelete={() => {
            const item = items.find((it) => it.id === menu.id);
            if (item) void onDelete(item);
          }}
        />
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Both states keep a 1px transparent border so toggling never
      // shifts adjacent chips by a pixel. Active = subtle bg fill, no
      // accent outline; the colour shift alone reads as "selected"
      // and avoids the loud halo a coloured ring/border produced.
      className={cn(
        'flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[10.5px] font-medium transition-colors',
        active ? 'bg-accent/12 text-accent' : 'text-fg-dim hover:bg-fg/5 hover:text-fg/90',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({
  hasQuery,
  favoritesOnly,
  query,
}: {
  hasQuery: boolean;
  favoritesOnly: boolean;
  query: string;
}) {
  if (hasQuery) {
    return (
      <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
        <Search className="text-fg-dim/60 h-4 w-4" />
        <p>No matches for "{truncate(query, 30)}".</p>
        <p className="text-fg-dim/70">Try a shorter or different query.</p>
      </div>
    );
  }
  if (favoritesOnly) {
    return (
      <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
        <Star className="text-fg-dim/60 h-4 w-4" />
        <p>No favorites yet.</p>
        <p className="text-fg-dim/70">Star a conversation to keep it close at hand.</p>
      </div>
    );
  }
  return (
    <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
      <Sparkles className="text-accent/60 h-4 w-4" />
      <p>No conversations yet.</p>
      <p className="text-fg-dim/70">Send a message in the chat panel to start one.</p>
    </div>
  );
}

interface GroupProps {
  label: string;
  items: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: ConversationSummary) => void;
  onToggleFavorite: (item: ConversationSummary) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (v: { id: string; value: string } | null) => void;
  onCommitRename: () => void;
}

function Group({
  label,
  items,
  activeId,
  onSelect,
  onContextMenu,
  onToggleFavorite,
  renaming,
  setRenaming,
  onCommitRename,
}: GroupProps) {
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <div className="text-fg-dim/70 px-3 pt-1.5 pb-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase">
        {label}
      </div>
      <ul className="flex flex-col">
        {items.map((it) => {
          const isActive = it.id === activeId;
          const isRenaming = renaming?.id === it.id;
          return (
            <li key={it.id} className="group/row relative">
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                onContextMenu={(e) => onContextMenu(e, it)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
                  'hover:bg-fg/5',
                  isActive && 'bg-accent/10',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  <OriginIcon origin={it.origin} pinned={it.pinned} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: it.id, value: e.target.value })}
                        onBlur={onCommitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onCommitRename();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenaming(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'text-fg flex-1 rounded border px-1 text-[12px] outline-none',
                          'border-accent/60 bg-fg/5',
                        )}
                      />
                    ) : (
                      <span
                        className={cn(
                          'truncate text-[12px] font-medium',
                          isActive ? 'text-fg' : 'text-fg/85',
                        )}
                      >
                        {it.title}
                      </span>
                    )}
                    <span className="text-fg-dim/60 shrink-0 text-[9.5px]">
                      {formatRelative(it.updated_at_ms)}
                    </span>
                  </div>
                  {it.last_preview && !isRenaming && (
                    <div className="text-fg-dim/70 mt-0.5 line-clamp-1 text-[10.5px] leading-snug">
                      {it.last_preview}
                    </div>
                  )}
                </div>
              </button>
              {/* Inline favorite toggle. Always rendered for favorited
                  rows (so the star stays a visible state badge), only
                  on hover for non-favorites (keeps the row clean by
                  default). Nested button so the parent row click
                  doesn't fire when we toggle. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(it);
                }}
                title={it.favorite ? 'Unfavorite' : 'Favorite'}
                aria-label={it.favorite ? 'Unfavorite conversation' : 'Favorite conversation'}
                className={cn(
                  'absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded transition-all',
                  'hover:bg-fg/10',
                  it.favorite
                    ? 'text-accent'
                    : 'text-fg-dim/0 group-hover/row:text-fg-dim/70 hover:text-fg',
                )}
              >
                <Star className="h-3 w-3" fill={it.favorite ? 'currentColor' : 'none'} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OriginIcon({ origin, pinned }: { origin: string; pinned: boolean }) {
  // The icon doubles as a "where did this conversation come from"
  // breadcrumb so the user doesn't have to read the title to figure
  // it out at a glance. Pinned overlays a tiny corner badge.
  let icon: React.ReactNode;
  switch (origin) {
    case 'why':
      icon = <FileSearch className="h-3 w-3" />;
      break;
    case 'log':
      icon = <Inbox className="h-3 w-3" />;
      break;
    case 'diff':
      icon = <GitBranch className="h-3 w-3" />;
      break;
    case 'commit':
      icon = <Check className="h-3 w-3" />;
      break;
    case 'standup':
      icon = <ListChecks className="h-3 w-3" />;
      break;
    case 'dashboard_report':
      icon = <Globe className="h-3 w-3" />;
      break;
    case 'advisory':
      icon = <Sparkles className="h-3 w-3" />;
      break;
    case 'free':
    default:
      icon = <MessageSquare className="h-3 w-3" />;
      break;
  }
  return (
    <span
      className={cn(
        'relative flex h-5 w-5 items-center justify-center rounded',
        'bg-fg/8 text-fg-dim',
      )}
    >
      {icon}
      {pinned && (
        <Pin className="text-accent absolute -top-0.5 -right-0.5 h-2 w-2" fill="currentColor" />
      )}
    </span>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ContextMenu({
  x,
  y,
  pinned,
  favorite,
  archived,
  onClose,
  onRename,
  onPin,
  onFavorite,
  onArchive,
  onDelete,
}: ContextMenuProps) {
  // We render in a portal-style absolute layer so the menu can
  // overflow the drawer's bounding box (a 4-row menu near the
  // bottom of a 100px-tall row would otherwise clip).
  useEffect(() => {
    const onDown = () => onClose();
    // Defer the listener so the same click that opened the menu
    // doesn't immediately close it.
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className={cn(
        'fixed z-50 min-w-[180px] py-1',
        'bg-surface-raised border-border/80 rounded-app border shadow-lg shadow-black/30',
      )}
    >
      <MenuItem icon={<Pencil className="h-3 w-3" />} label="Rename" onClick={onRename} />
      <MenuItem
        icon={pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        label={pinned ? 'Unpin' : 'Pin'}
        onClick={onPin}
      />
      <MenuItem
        icon={favorite ? <StarOff className="h-3 w-3" /> : <Star className="h-3 w-3" />}
        label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={onFavorite}
      />
      <MenuItem
        icon={archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
        label={archived ? 'Unarchive' : 'Archive'}
        onClick={onArchive}
      />
      <div className="border-border/60 my-1 border-t" />
      <MenuItem icon={<Trash2 className="h-3 w-3" />} label="Delete…" onClick={onDelete} danger />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition-colors',
        'hover:bg-fg/5',
        danger ? 'text-status-error' : 'text-fg/85',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-status-error' : 'text-fg-dim')}>{icon}</span>
      {label}
    </button>
  );
}

/**
 * Concise relative timestamp for the conversation row. We keep it
 * tiny (max 5 chars) so it fits in the trailing column without
 * pushing the title to wrap. Anything older than a week falls back
 * to a date so "3w" doesn't drift indefinitely.
 */
function formatRelative(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  // Past a week: render as "Mon 3" — short enough not to wrap, more
  // useful at a glance than "12d / 23d / 47d / 89d".
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}
