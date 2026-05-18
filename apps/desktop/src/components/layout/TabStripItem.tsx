import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { BookOpen, FileText, ScrollText, TerminalSquare, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { Tab, TabKind } from './layoutModel';

const TAB_ICON: Record<TabKind, ComponentType<{ className?: string }>> = {
  logs: ScrollText,
  docs: BookOpen,
  notes: FileText,
  terminal: TerminalSquare,
};

interface TabStripItemProps {
  tab: Tab;
  groupId: string;
  insertIndex: number;
  active: boolean;
  groupFocused: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
}

export function TabStripItem({
  tab,
  groupId,
  insertIndex,
  active,
  groupFocused,
  onActivate,
  onClose,
  onRename,
}: TabStripItemProps) {
  const closeable =
    tab.kind === 'terminal' ||
    (tab.kind === 'logs' && Boolean(tab.commandName)) ||
    tab.kind === 'docs' ||
    tab.kind === 'notes';
  const renameable = tab.kind === 'terminal';
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `tab:${tab.id}`,
    data: { kind: 'tab', tabId: tab.id, sourceGroupId: groupId },
  });
  const { setNodeRef: setDropRef, isOver: isOverDrop } = useDroppable({
    id: `tab-slot:${tab.id}`,
    data: { kind: 'tab-slot', groupId, insertIndex },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(tab.title);
  }, [tab.title, editing]);

  const beginEdit = useCallback(() => {
    if (!renameable) return;
    setDraft(tab.title);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [renameable, tab.title]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.title) onRename(tab.id, trimmed);
  }, [draft, onRename, tab.id, tab.title]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(tab.title);
  }, [tab.title]);

  const Icon = TAB_ICON[tab.kind];
  const isCommandLog = tab.kind === 'logs' && Boolean(tab.commandName);
  const displayTitle = isCommandLog ? `CMD Logs · ${tab.title}` : tab.title;
  const usesFocusTier = tab.kind === 'terminal';
  const showBrightActive = active && (!usesFocusTier || groupFocused);
  const showMutedActive = active && usesFocusTier && !groupFocused;
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div
      ref={setRef}
      data-tab-id={tab.id}
      onClick={() => !editing && onActivate(tab.id)}
      onDoubleClick={beginEdit}
      title={renameable ? `${displayTitle} — double-click to rename` : displayTitle}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors',
        'border-border/40 border-r',
        showBrightActive
          ? 'bg-accent/15 text-fg'
          : showMutedActive
            ? 'bg-surface-muted text-fg-muted'
            : 'text-fg-dim hover:text-fg hover:bg-surface-overlay/40',
        isDragging && 'opacity-40',
      )}
      {...dragListeners}
      {...dragAttrs}
      role={undefined}
      tabIndex={undefined}
    >
      <Icon
        className={cn(
          'h-3 w-3 shrink-0',
          showBrightActive ? 'text-accent' : showMutedActive ? 'text-fg-muted' : 'text-fg-dim',
        )}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          maxLength={40}
          className={cn(
            'border-accent/50 bg-surface text-fg',
            'rounded-app-sm h-5 w-28 border px-1 text-[12px]',
            'focus:border-accent focus:outline-none',
          )}
        />
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          {isCommandLog && (
            <span className="border-border/70 bg-surface-muted text-fg-muted rounded-[3px] border px-1 font-mono text-[9px] leading-4 font-semibold tracking-[0.03em] uppercase">
              CMD Logs
            </span>
          )}
          <span className="truncate">{tab.title}</span>
        </span>
      )}
      {closeable && !editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Close ${displayTitle}`}
          title={`Close ${displayTitle}`}
          className={cn(
            'text-fg-dim hover:bg-status-error/15 hover:text-status-error',
            'rounded-app-sm flex h-4 w-4 shrink-0 items-center justify-center transition',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 right-0 left-0 h-[2px] transition-colors',
          showBrightActive ? 'bg-accent' : showMutedActive ? 'bg-fg-dim/40' : 'bg-transparent',
        )}
      />
      {isOverDrop && (
        <span aria-hidden className="bg-accent absolute top-1 bottom-1 left-0 w-0.5 rounded-full" />
      )}
    </div>
  );
}
