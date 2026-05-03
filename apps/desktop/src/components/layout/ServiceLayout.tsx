/**
 * Recursive layout renderer for the per-service panel.
 *
 * Owns:
 *   - DndContext for the entire service's tab drag-and-drop.
 *   - Recursive walk of the layout tree, rendering each `SplitNode`
 *     as a `react-resizable-panels` `PanelGroup` and each
 *     `GroupNode` as a `GroupPane` (tab strip + body slot).
 *   - Portal target registry: every body slot exposes its DOM node
 *     to the parent (`LogPanel`) via `onSlotRef`, so the parent's
 *     mount-stable `<TabBodyHost>` instances can `createPortal`
 *     into the right pane without re-mounting when a tab moves.
 *
 * Body content itself does NOT live here — `LogPanel` mounts each
 * tab body once and portals it to whichever slot this component
 * registers. That way moving a `terminal` tab between groups is a
 * pure DOM relocation; the underlying React tree (and the PTY
 * underneath) stay alive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import { cn } from '@/lib/cn';

import { GroupTabStrip } from './GroupTabStrip';
import { PaneDropZones } from './PaneDropZones';
import {
  findGroupByTab,
  type GroupNode,
  type LayoutNode,
  type SplitEdge,
  type SplitNode,
} from './layoutModel';
import type { UseServiceLayoutResult } from './useServiceLayout';

interface Props {
  layout: UseServiceLayoutResult;
  /**
   * Slot registry callback. Called for EVERY tab (not just the
   * active one) so the parent can mount each tab body once into
   * a stable DOM node and have it survive both pane drag-drops
   * (target moves between groups) and tab activation toggles
   * (sibling tab in the same group hides this one). We toggle
   * visibility via CSS, not via slot existence — that way no
   * `<TerminalPane>` ever unmounts during normal navigation.
   */
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
  /**
   * "Empty pane" CTA. Rendered when a group ends up with zero
   * visible tabs (e.g. user closed the last terminal in a split-
   * off pane); we offer to spawn a fresh terminal so the empty
   * pane self-heals without forcing them to drag a tab back.
   */
  onAddTerminalToEmpty: (groupId: string) => void;
}

interface DragState {
  tabId: string;
  sourceGroupId: string;
}

export function ServiceLayout({ layout, onSlotRef, onAddTerminalToEmpty }: Props) {
  const {
    state,
    activate,
    addTerminal,
    closeTab,
    renameTab,
    moveTab,
    splitTab,
    resizeSplit,
    reset,
  } = layout;

  // ---- Drag state (ref for collision detection only) ---------------------
  // We track the active drag in component state so child panes can
  // toggle their visible drop overlay. dnd-kit's `useDndMonitor`
  // would also work but adds an extra subscription; component
  // state is fine for one drag at a time.
  const [drag, setDrag] = useState<DragState | null>(null);

  // ---- Pane focus tracking ----------------------------------------------
  // Which pane currently owns the user's attention. We track this
  // because tab styling depends on it: the active tab in the
  // focused pane lights up in accent (so a user with three
  // terminals visible can tell which PTY their next keystroke
  // will land in), background panes' active tabs render as muted
  // so they don't compete.
  //
  // Two listeners, both rooted on this layout's container so they
  // never fire for an unrelated service tab in another LogPanel:
  //
  //   1. `focusin` — catches keyboard / programmatic focus. xterm
  //      moves focus to its hidden textarea on click, this fires.
  //   2. `pointerdown` (capture) — catches clicks that DON'T
  //      trigger a focusin: e.g. the Notes preview pane has no
  //      focusable element, so clicking it would leave the
  //      previously-focused terminal marked as "focused" forever.
  //      Pointer-down is the most reliable "I'm interacting with
  //      this region now" signal; capture-phase ensures we see it
  //      even if a child stops propagation.
  //
  // Deliberately no `focusout` handler: losing focus to a chip on
  // the toolbar or the browser chrome shouldn't strip the marker.
  // The next focus / click into a pane will overwrite it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // `closest` walks up the composed DOM tree; it stops at the
      // first ancestor with `data-pane-id`, which is the GroupPane
      // wrapper. Inactive (visibility:hidden) panes can't receive
      // pointer events, so we never accidentally mark a hidden
      // pane as focused via this path.
      const pane = target.closest('[data-pane-id]') as HTMLElement | null;
      if (!pane) return;
      const id = pane.getAttribute('data-pane-id');
      if (id) setFocusedGroupId(id);
    };
    el.addEventListener('focusin', update);
    el.addEventListener('pointerdown', update, true);
    return () => {
      el.removeEventListener('focusin', update);
      el.removeEventListener('pointerdown', update, true);
    };
  }, []);
  // If the focused pane disappears from the tree (closed last tab,
  // collapsed by a sibling drag), forget it so the next focus
  // event can reassign cleanly. Reading the flat group list off
  // state means we react instantly to layout reducer actions.
  useEffect(() => {
    if (focusedGroupId == null) return;
    const stillExists = listGroupsLite(state.root).some((id) => id === focusedGroupId);
    if (!stillExists) setFocusedGroupId(null);
  }, [state.root, focusedGroupId]);

  // dnd-kit sensors: 5 px activation distance avoids flicker drags
  // on micro-movements during click-to-activate gestures.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | { kind: 'tab'; tabId: string; sourceGroupId: string }
      | undefined;
    if (data?.kind !== 'tab') return;
    setDrag({ tabId: data.tabId, sourceGroupId: data.sourceGroupId });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDrag(null);
      const active = event.active.data.current as
        | { kind: 'tab'; tabId: string; sourceGroupId: string }
        | undefined;
      const over = event.over?.data.current as
        | { kind: 'tab-slot'; groupId: string; insertIndex: number }
        | { kind: 'pane-edge'; groupId: string; edge: SplitEdge }
        | { kind: 'pane-center'; groupId: string }
        | undefined;
      if (!active || active.kind !== 'tab' || !over) return;
      const { tabId, sourceGroupId } = active;

      if (over.kind === 'tab-slot') {
        // Reorder/move into a tab strip.
        let insertIndex = over.insertIndex;
        // When dragging within the same group to a position after
        // the source's current index, we have to subtract one
        // because the source will be removed before the insert
        // happens. Without this, dragging tab 2 to "between 4
        // and 5" would land it between 3 and 4.
        if (over.groupId === sourceGroupId) {
          const sourceGroup = findGroupByTab(state.root, tabId);
          if (sourceGroup) {
            const currentIdx = sourceGroup.tabs.indexOf(tabId);
            if (currentIdx >= 0 && currentIdx < insertIndex) {
              insertIndex -= 1;
            }
            // No-op: dropping onto own slot
            if (currentIdx === insertIndex) return;
          }
        }
        moveTab(tabId, over.groupId, insertIndex);
      } else if (over.kind === 'pane-center') {
        // Move into the target group at the end. No-op if already
        // the only tab there.
        if (over.groupId === sourceGroupId) return;
        moveTab(tabId, over.groupId);
      } else if (over.kind === 'pane-edge') {
        splitTab(tabId, over.groupId, over.edge);
      }
    },
    [moveTab, splitTab, state.root],
  );

  const handleDragCancel = useCallback(() => {
    setDrag(null);
  }, []);

  // ---- Recursive tree render --------------------------------------------
  const renderNode = useCallback(
    (node: LayoutNode, isRoot: boolean): React.ReactNode => {
      if (node.type === 'group') {
        return (
          <GroupPane
            key={node.id}
            group={node}
            tabs={state.tabs}
            includeDocs={state.includeDocs}
            onActivate={(tabId) => activate(node.id, tabId)}
            onClose={closeTab}
            onRename={renameTab}
            onAddTerminal={() => addTerminal(node.id)}
            onAddTerminalToEmpty={() => onAddTerminalToEmpty(node.id)}
            onReset={isRoot ? reset : null}
            onSlotRef={onSlotRef}
            dragActive={drag !== null}
            focused={focusedGroupId === node.id}
          />
        );
      }
      return (
        <SplitPane
          key={node.id}
          node={node}
          renderChild={(child) => renderNode(child, false)}
          onResize={resizeSplit}
        />
      );
    },
    [
      activate,
      addTerminal,
      closeTab,
      drag,
      focusedGroupId,
      onAddTerminalToEmpty,
      onSlotRef,
      renameTab,
      reset,
      resizeSplit,
      state.includeDocs,
      state.tabs,
    ],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        {renderNode(state.root, true)}
      </div>
    </DndContext>
  );
}

/**
 * Cheap "list group ids only" walker — used by the focus cleanup
 * effect to test whether the previously-focused group still exists
 * in the tree. We don't reuse `listGroups` from layoutModel because
 * that returns full GroupNode objects and we only need the ids;
 * the indirection saves an allocation per layout change.
 */
function listGroupsLite(node: LayoutNode): string[] {
  if (node.type === 'group') return [node.id];
  return [...listGroupsLite(node.children[0]), ...listGroupsLite(node.children[1])];
}

// ---------------------------------------------------------------------------
// Split node — react-resizable-panels wrapper.
// ---------------------------------------------------------------------------

interface SplitPaneProps {
  node: SplitNode;
  renderChild: (child: LayoutNode) => React.ReactNode;
  onResize: (splitId: string, sizes: [number, number]) => void;
}

function SplitPane({ node, renderChild, onResize }: SplitPaneProps) {
  // Debounced commit of the split size into the layout reducer.
  //
  // `react-resizable-panels` already updates the rendered split
  // visually on every pointermove via direct DOM manipulation —
  // the `onLayout` callback is just a notification so we can
  // persist the final sizes for the next session. Dispatching
  // into our reducer on *every* notification (60 Hz during a
  // smooth drag) caused a re-render storm: the entire layout
  // tree, every SplitPane, every TabGroup, every body host
  // re-rendered each frame, fighting the lib's own DOM updates
  // and dragging the resize cursor on busier services. We now
  // hold the latest sizes in a ref and only flush to the reducer
  // once the drag has been idle for ~80 ms. The end-of-drag
  // commit always lands because the cleanup effect flushes any
  // pending timer when the SplitPane unmounts (e.g., the user
  // collapses the split entirely), and the comparator below
  // skips no-op writes so steady-state idle stays free.
  const latestSizes = useRef<[number, number]>(node.sizes);
  const flushTimer = useRef<number | null>(null);

  const handleLayout = useCallback(
    (sizes: number[]) => {
      const a = sizes[0] ?? 50;
      const b = sizes[1] ?? 50;
      latestSizes.current = [a, b];
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const [na, nb] = latestSizes.current;
        // Skip the persist if sizes are unchanged (within 0.1 %)
        // — avoids a steady drizzle of writes when the lib reports
        // a final layout that matches what the reducer already has.
        if (Math.abs(na - node.sizes[0]) < 0.1 && Math.abs(nb - node.sizes[1]) < 0.1) return;
        onResize(node.id, latestSizes.current);
      }, 80);
    },
    [node.id, node.sizes, onResize],
  );

  useEffect(
    () => () => {
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  return (
    <PanelGroup
      direction={node.orientation}
      onLayout={handleLayout}
      // The id pins the underlying lib's autosaver to our reducer-
      // managed identity; without this, two splits with the same
      // child sizes share storage and one stomps the other.
      id={node.id}
      className="flex min-h-0 flex-1"
    >
      <Panel defaultSize={node.sizes[0]} minSize={10}>
        <div className="flex h-full min-h-0 flex-1">{renderChild(node.children[0])}</div>
      </Panel>
      {/* Resize handle.
          Sized 2 px at rest (instead of the previous hairline 1 px)
          so the divider reads as an actual structural seam at a
          glance, and uses a higher-contrast colour token
          (`border-strong`) instead of the muted `border/60` that
          got lost against the surrounding panes. Grows to 4 px on
          hover/drag and snaps to the accent — same affordance
          pattern VS Code uses, just with a thicker idle baseline
          so the user can find the handle without prowling around
          for the cursor change. */}
      <PanelResizeHandle
        className={cn(
          'group/handle',
          node.orientation === 'horizontal'
            ? 'w-[2px] hover:w-1 active:w-1'
            : 'h-[2px] hover:h-1 active:h-1',
          'bg-border-strong hover:bg-accent active:bg-accent transition-all',
        )}
      />
      <Panel defaultSize={node.sizes[1]} minSize={10}>
        <div className="flex h-full min-h-0 flex-1">{renderChild(node.children[1])}</div>
      </Panel>
    </PanelGroup>
  );
}

// ---------------------------------------------------------------------------
// Group pane — tab strip + body slot + drop overlay.
// ---------------------------------------------------------------------------

interface GroupPaneProps {
  group: GroupNode;
  tabs: Record<string, import('./layoutModel').Tab>;
  includeDocs: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
  onAddTerminal: () => void;
  onAddTerminalToEmpty: () => void;
  onReset: (() => void) | null;
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
  dragActive: boolean;
  /** Pane currently owns keyboard focus. Drives the active tab's
   *  highlight tier — focused panes get the bright accent fill,
   *  background panes get a subdued muted fill so the user can
   *  always tell which terminal their next keystroke will land in. */
  focused: boolean;
}

function GroupPane({
  group,
  tabs,
  includeDocs,
  onActivate,
  onClose,
  onRename,
  onAddTerminal,
  onAddTerminalToEmpty,
  onReset,
  onSlotRef,
  dragActive,
  focused,
}: GroupPaneProps) {
  // Filter the visible tab list the same way GroupTabStrip does so
  // "active tab missing" doesn't paint an empty body when only a
  // hidden docs tab survives. Defensive fallback to first visible
  // tab — the reducer should keep `activeTab` valid but we don't
  // rely on it for render correctness.
  const visibleIds = useMemo(
    () => group.tabs.filter((id) => tabs[id] && (tabs[id]!.kind !== 'docs' || includeDocs)),
    [group.tabs, tabs, includeDocs],
  );
  const activeTabId = useMemo(() => {
    if (group.activeTab && visibleIds.includes(group.activeTab)) return group.activeTab;
    return visibleIds[0] ?? null;
  }, [group.activeTab, visibleIds]);

  return (
    <div
      data-pane-id={group.id}
      className="bg-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <GroupTabStrip
        group={group}
        tabs={tabs}
        includeDocs={includeDocs}
        onActivate={onActivate}
        onClose={onClose}
        onRename={onRename}
        onAddTerminal={onAddTerminal}
        onReset={onReset}
        groupFocused={focused}
      />
      <div className="relative flex min-h-0 flex-1">
        {visibleIds.length === 0 ? (
          <EmptyPaneState onAddTerminal={onAddTerminalToEmpty} />
        ) : (
          // Render a slot div for EVERY visible tab (not just
          // the active one). Inactive slots stay mounted but use
          // `visibility: hidden` — that way the body component
          // (TerminalPane, LogXtermView, ...) the parent portals
          // into them keeps its layout, ResizeObservers fire on
          // real geometry, and no PTY dies on tab activation.
          visibleIds.map((tabId) => (
            <BodySlot
              key={tabId}
              tabId={tabId}
              active={tabId === activeTabId}
              onSlotRef={onSlotRef}
            />
          ))
        )}
        {/* Drop overlay sits above the body and registers the four
            edge droppables + center. Always mounted (so dnd-kit
            collision detection works the moment the drag starts);
            visible accent only renders during an active drag. */}
        <PaneDropZones groupId={group.id} visible={dragActive} />
      </div>
    </div>
  );
}

interface BodySlotProps {
  tabId: string;
  active: boolean;
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
}

function BodySlot({ tabId, active, onSlotRef }: BodySlotProps) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => onSlotRef(tabId, el),
    [tabId, onSlotRef],
  );
  return (
    <div
      ref={setRef}
      data-tab-slot={tabId}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        // `invisible` (visibility:hidden) keeps the box laid out so
        // ResizeObserver / xterm fit calculations don't see 0×0.
        // `pointer-events-none` prevents the hidden body from
        // catching clicks meant for the active tab on top of it.
        !active && 'pointer-events-none invisible',
      )}
    />
  );
}

function EmptyPaneState({ onAddTerminal }: { onAddTerminal: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <button
        type="button"
        onClick={onAddTerminal}
        className="text-fg-dim hover:text-fg hover:bg-surface-overlay/60 rounded-app-sm border-border/40 border px-3 py-2 text-[12px] transition"
      >
        Empty pane — click to start a new terminal
      </button>
    </div>
  );
}
