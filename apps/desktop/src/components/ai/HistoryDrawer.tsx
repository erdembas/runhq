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
  Sparkles,
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
 * (Today / Yesterday / Older). Each row shows the origin icon, the
 * title, a one-line preview of the last message, and the relative
 * time stamp. Right-clicking a row opens a small menu with rename /
 * pin / archive / delete actions.
 *
 * Lives in its own file rather than inline inside `AiChatPanel.tsx`
 * because the chat panel is already 1500 lines; keeping the drawer
 * here keeps the diff for the multi-conversation refactor reviewable.
 *
 * Visual contract:
 *   - Slides in over the chat panel (z-index above the panel, below
 *     global modals). Click outside / Esc closes.
 *   - Active conversation is highlighted with the accent colour.
 *   - Pinned conversations sit at the top under a "Pinned" header.
 *   - Archived conversations are hidden by default; a footer toggle
 *     reveals them.
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
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
    pinned: boolean;
    archived: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Refresh the list from IPC. Called on open, after every mutation
   * (rename/pin/archive/delete), and when the user toggles archived.
   * We deliberately re-fetch from scratch rather than mutating the
   * local array — the backend's pin-then-recency sort is opinionated
   * and we'd otherwise have to re-implement it client-side.
   */
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ipc.listConversations({
        limit: 500,
        include_archived: includeArchived,
      });
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  // Esc to close. We attach the listener only while open so it
  // doesn't fight the chat panel's own Esc handler in drawer mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Close the context menu first, then the drawer — same
        // priority as any layered overlay.
        if (menu) setMenu(null);
        else if (renaming) setRenaming(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, menu, renaming]);

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

  /** Group rows into Pinned / Today / Yesterday / Older. Order
   *  inside groups follows the backend's `ORDER BY pinned DESC,
   *  updated_at_ms DESC`. */
  const groups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    const pinned: ConversationSummary[] = [];
    const today: ConversationSummary[] = [];
    const yesterday: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];
    for (const it of items) {
      if (it.pinned) {
        pinned.push(it);
        continue;
      }
      if (it.updated_at_ms >= startOfToday) today.push(it);
      else if (it.updated_at_ms >= startOfYesterday) yesterday.push(it);
      else older.push(it);
    }
    return { pinned, today, yesterday, older };
  }, [items]);

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
            <div className="text-fg-dim flex flex-col items-center gap-2 px-4 py-8 text-center text-[11px]">
              <Sparkles className="text-accent/60 h-4 w-4" />
              <p>No conversations yet.</p>
              <p className="text-fg-dim/70">Send a message in the chat panel to start one.</p>
            </div>
          ) : (
            <>
              <Group
                label="Pinned"
                items={groups.pinned}
                activeId={activeConversationId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
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
        </footer>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          pinned={menu.pinned}
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

interface GroupProps {
  label: string;
  items: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: ConversationSummary) => void;
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
            <li key={it.id}>
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
  archived: boolean;
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ContextMenu({
  x,
  y,
  pinned,
  archived,
  onClose,
  onRename,
  onPin,
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
