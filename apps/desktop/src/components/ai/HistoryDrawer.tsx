import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type { ConversationSummary } from '@/types';
import { ContextMenu } from './history-drawer/ContextMenu';
import { ConversationGroup } from './history-drawer/ConversationGroup';
import { EmptyState } from './history-drawer/EmptyState';
import { HistorySearchFilters } from './history-drawer/HistorySearchFilters';
import { groupConversations, truncate } from './history-drawer/model';
import type { RenameState } from './history-drawer/types';

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
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [renaming, setRenaming] = useState<RenameState>(null);
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

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === appliedQuery) return;
    const id = setTimeout(() => setAppliedQuery(trimmed), 180);
    return () => clearTimeout(id);
  }, [query, appliedQuery]);

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

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (menu) setMenu(null);
      else if (renaming) setRenaming(null);
      else if (query) {
        setQuery('');
        setAppliedQuery('');
      } else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, menu, renaming, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node || !(e.target instanceof Node) || node.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mouseup', onDown);
    return () => window.removeEventListener('mouseup', onDown);
  }, [open, onClose]);

  const groups = useMemo(() => groupConversations(items), [items]);
  const isFlatMode = appliedQuery.length > 0 || favoritesOnly;

  const onContextMenu = useCallback((e: React.MouseEvent, item: ConversationSummary) => {
    e.preventDefault();
    setMenu({
      id: item.id,
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: e.clientY,
      pinned: item.pinned,
      favorite: item.favorite,
      archived: item.archived,
    });
  }, []);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (!value) {
      setRenaming(null);
      return;
    }
    try {
      await ipc.renameConversation(renaming.id, value);
    } catch (e) {
      console.error('rename failed', e);
    }
    setRenaming(null);
    void reload();
  }, [renaming, reload]);

  const onFavorite = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
      const next = !item.favorite;
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: next } : it)));
      try {
        await ipc.favoriteConversation(item.id, next);
      } catch (e) {
        console.error('favorite failed', e);
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: !next } : it)));
        return;
      }
      void reload();
    },
    [reload],
  );

  const mutateConversation = useCallback(
    async (fn: () => Promise<unknown>) => {
      setMenu(null);
      try {
        await fn();
      } catch (e) {
        console.error('history mutation failed', e);
      }
      void reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    async (item: ConversationSummary) => {
      setMenu(null);
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

  const renderGroup = (label: string, groupItems: ConversationSummary[]) => (
    <ConversationGroup
      label={label}
      items={groupItems}
      activeId={activeConversationId}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onToggleFavorite={onFavorite}
      renaming={renaming}
      setRenaming={setRenaming}
      onCommitRename={commitRename}
    />
  );

  const menuItem = menu ? items.find((it) => it.id === menu.id) : null;

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

        <HistorySearchFilters
          query={query}
          appliedQuery={appliedQuery}
          favoritesOnly={favoritesOnly}
          searchInputRef={searchInputRef}
          setQuery={setQuery}
          setAppliedQuery={setAppliedQuery}
          setFavoritesOnly={setFavoritesOnly}
        />

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
            renderGroup(
              appliedQuery ? `Results for "${truncate(appliedQuery, 20)}"` : 'Favorites',
              items,
            )
          ) : (
            <>
              {renderGroup('Pinned', groups.pinned)}
              {renderGroup('Favorites', groups.favorites)}
              {renderGroup('Today', groups.today)}
              {renderGroup('Yesterday', groups.yesterday)}
              {renderGroup('Older', groups.older)}
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

      {menu && menuItem && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          pinned={menu.pinned}
          favorite={menu.favorite}
          archived={menu.archived}
          onClose={() => setMenu(null)}
          onRename={() => {
            setMenu(null);
            setRenaming({ id: menuItem.id, value: menuItem.title });
          }}
          onPin={() =>
            void mutateConversation(() => ipc.pinConversation(menuItem.id, !menuItem.pinned))
          }
          onFavorite={() => void onFavorite(menuItem)}
          onArchive={() =>
            void mutateConversation(() => ipc.archiveConversation(menuItem.id, !menuItem.archived))
          }
          onDelete={() => void onDelete(menuItem)}
        />
      )}
    </>
  );
}
