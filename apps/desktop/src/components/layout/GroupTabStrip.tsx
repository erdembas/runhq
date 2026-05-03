/**
 * Tab strip for a single layout group. Drag source per tab,
 * drop targets per tab gap (reorder / insert into this group).
 *
 * Pane-level drop targets (split-on-edge) live in `PaneDropZones`,
 * which overlays each group's body during an active drag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { BookOpen, FileText, Plus, RotateCcw, ScrollText, TerminalSquare, X } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { GroupNode, Tab, TabKind } from './layoutModel';

interface Props {
  group: GroupNode;
  tabs: Record<string, Tab>;
  /** Hide the docs tab without forgetting where it lives. */
  includeDocs: boolean;
  /** Currently-active tab id of the group, drives the underline. */
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
  onAddTerminal: () => void;
  /** Reset the layout for the whole service. Header-level. Only the
   *  *root* group renders this affordance; passing `null` for the
   *  non-root groups suppresses the button. */
  onReset: (() => void) | null;
  /** This group's pane currently owns keyboard focus. Tabs in a
   *  focused pane render with a brighter accent fill so the user
   *  can locate "where my next keystroke goes" at a glance even
   *  with multiple terminals visible side-by-side. */
  groupFocused: boolean;
}

const TAB_ICON: Record<TabKind, React.ComponentType<{ className?: string }>> = {
  logs: ScrollText,
  docs: BookOpen,
  notes: FileText,
  terminal: TerminalSquare,
};

export function GroupTabStrip({
  group,
  tabs,
  includeDocs,
  onActivate,
  onClose,
  onRename,
  onAddTerminal,
  onReset,
  groupFocused,
}: Props) {
  const visibleIds = group.tabs.filter((id) => {
    const t = tabs[id];
    if (!t) return false;
    if (t.kind === 'docs' && !includeDocs) return false;
    return true;
  });

  return (
    <div
      className="border-border/60 bg-surface flex shrink-0 items-stretch border-b"
      data-group-id={group.id}
    >
      <div className="scrollbar-none flex flex-1 items-stretch overflow-x-auto">
        {visibleIds.map((tabId, idx) => {
          const tab = tabs[tabId]!;
          return (
            <TabItem
              key={tabId}
              tab={tab}
              groupId={group.id}
              insertIndex={idx}
              active={tab.id === group.activeTab}
              groupFocused={groupFocused}
              onActivate={onActivate}
              onClose={onClose}
              onRename={onRename}
            />
          );
        })}
        {/* Trailing drop slot: catches drops past the last tab so a
            user dragging "to the end of this strip" doesn't have to
            land precisely on the previous tab's right half. */}
        <TabEndSlot groupId={group.id} insertIndex={visibleIds.length} />
      </div>
      <div className="border-border/60 flex shrink-0 items-center gap-1 border-l px-2">
        {/* Trailing strip actions. Captioned (icon + label) instead
            of icon-only because both buttons land on the END of
            the tab strip — a region where users skim text more
            than icons. The previous icon-only "+" + "↻" pair was
            mistaken for tab decorations more than once during
            usability checks; the captions break that ambiguity. */}
        <StripAction
          icon={<Plus className="h-3 w-3" />}
          label="New Terminal"
          title="New terminal in this pane"
          onClick={onAddTerminal}
        />
        {onReset && (
          <StripAction
            icon={<RotateCcw className="h-3 w-3" />}
            label="Reset Layout"
            title="Reset layout to default"
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trailing strip actions (icon + caption).
// ---------------------------------------------------------------------------

interface StripActionProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}

function StripAction({ icon, label, title, onClick }: StripActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-app-sm flex h-6 items-center gap-1 px-1.5 text-[11px] font-medium transition-colors',
        'text-fg-dim hover:text-fg hover:bg-surface-overlay/60',
        'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab item.
// ---------------------------------------------------------------------------

interface TabItemProps {
  tab: Tab;
  groupId: string;
  insertIndex: number;
  active: boolean;
  /** Owning pane currently has keyboard focus — drives the
   *  focused-vs-background visual tier on the active tab. */
  groupFocused: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
}

function TabItem({
  tab,
  groupId,
  insertIndex,
  active,
  groupFocused,
  onActivate,
  onClose,
  onRename,
}: TabItemProps) {
  const closeable = tab.kind === 'terminal';
  const renameable = tab.kind === 'terminal';

  // ---- Drag source ---------------------------------------------------------
  // The dragged data carries the tab id; the layout reducer
  // resolves source group / position lazily because tabs only ever
  // live in one place at a time (no need to ship that info on the
  // drag payload).
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `tab:${tab.id}`,
    data: { kind: 'tab', tabId: tab.id, sourceGroupId: groupId },
  });

  // ---- Drop target (re-order before this tab) ------------------------------
  const { setNodeRef: setDropRef, isOver: isOverDrop } = useDroppable({
    id: `tab-slot:${tab.id}`,
    data: { kind: 'tab-slot', groupId, insertIndex },
  });

  // ---- Inline rename -------------------------------------------------------
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

  // Focus-tier styling only applies to terminals — they're the
  // only tab kind whose body actually consumes keystrokes, so the
  // "is this where my next char lands" hint is meaningful. Logs /
  // Docs / Notes are read-or-edit surfaces with no PTY-style
  // ambiguity, and the focused/unfocused dimming made them feel
  // accidentally disabled when the user clicked into a sibling
  // terminal. They render at the bright tier whenever active.
  const usesFocusTier = tab.kind === 'terminal';
  const showBrightActive = active && (!usesFocusTier || groupFocused);
  const showMutedActive = active && usesFocusTier && !groupFocused;

  // The double-ref dance: this DOM node is BOTH a draggable handle
  // AND a drop target (for "insert before me"). dnd-kit handles
  // the case fine but we need to compose the two `setNodeRef`s.
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
      title={renameable ? `${tab.title} — double-click to rename` : tab.title}
      // Three-tier styling — but only terminals participate in
      // the focused-vs-background split (see `usesFocusTier`):
      //   • bright (active && (non-terminal || focused pane))
      //   • muted-active (terminal that's active in a background
      //     pane — still painted on its body, but not where the
      //     keystrokes are going),
      //   • dim (everything else).
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
      // dnd-kit kit's listeners need to be on the same node as the
      // ref so the pointer-down handler can track movement. We DON'T
      // forward `attributes.role="button"` because activating via
      // keyboard would steal Enter from the inline rename input;
      // tab activation happens through the click handler above.
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
          // Prevent the draggable's pointer-down from stealing
          // typing focus and triggering a tab move while the user
          // is editing the label.
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
        <span className="truncate">{tab.title}</span>
      )}
      {closeable && !editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          // Don't let the X button trigger drag start when the user
          // missed the close target by a pixel — the pointer-down
          // listener on the parent div would otherwise capture it.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Close ${tab.title}`}
          title={`Close ${tab.title}`}
          className={cn(
            'text-fg-dim hover:bg-status-error/15 hover:text-status-error',
            'rounded-app-sm flex h-4 w-4 shrink-0 items-center justify-center transition',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      {/* Top accent bar — VS Code / JetBrains style "this tab owns
          the body below it" cue. Two-pixel height reads cleanly at
          both light and dark themes; corners stay square so it
          visually anchors to the body, not to the tab box.
          Background panes get a faded bar so the indicator stays
          recognisable but doesn't compete with the focused pane's
          full-strength accent. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 right-0 left-0 h-[2px] transition-colors',
          showBrightActive ? 'bg-accent' : showMutedActive ? 'bg-fg-dim/40' : 'bg-transparent',
        )}
      />
      {/* Drop indicator: thin accent bar on the leading edge when
          a drag would insert before us. */}
      {isOverDrop && (
        <span aria-hidden className="bg-accent absolute top-1 bottom-1 left-0 w-0.5 rounded-full" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trailing slot (catches "drop past the last tab" gestures).
// ---------------------------------------------------------------------------

function TabEndSlot({ groupId, insertIndex }: { groupId: string; insertIndex: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tab-slot:end:${groupId}`,
    data: { kind: 'tab-slot', groupId, insertIndex },
  });
  return (
    <div ref={setNodeRef} className="relative flex min-w-[24px] flex-1">
      {isOver && (
        <span aria-hidden className="bg-accent absolute top-1 bottom-1 left-0 w-0.5 rounded-full" />
      )}
    </div>
  );
}
