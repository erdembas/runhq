import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Layers,
  ListX,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusDot';
import { FileContextMenu, type FileContextMenuEntry } from '@/components/ui/FileContextMenu';
import { useAppStore, mainTabKey, DASHBOARD_TAB_KEY } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import type { MainTab } from '@/store/useAppStore';
import type { Status } from '@/types';

/**
 * Lock drag movement to the X axis. Tab strips are inherently 1-D —
 * letting a tab drift up/down while the user reorders makes the tab
 * feel like it's about to fall out of the bar (the most reported
 * "drag feels weird" symptom). Inlined here as a 4-line pure
 * function so we don't pull `@dnd-kit/modifiers` for one modifier.
 */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

/**
 * Horizontal tab strip rendered at the top of the main content area.
 *
 * Each open service / stack lives as its own tab; the dashboard sits
 * at the leftmost slot as a permanent "home" tab that cannot be
 * closed, reordered, or pinned. Clicking a tab activates it via
 * {@link setActiveMainTab}; clicking the small × on hover (or
 * middle-clicking) closes it. Right-clicking surfaces a VSCode-style
 * context menu with bulk-close and pin/reorder affordances:
 *
 *   - Pin / Unpin Tab       — toggle pinned state (Chrome-parity)
 *   - Move Left / Right     — slide the tab one slot within its zone
 *   - Close                 — close just this tab
 *   - Close Others          — keep this tab + dashboard + pinned, close the rest
 *   - Close to the Right    — close every tab strictly after the anchor (preserves pinned)
 *   - Close to the Left     — close every tab between dashboard and anchor (preserves pinned)
 *   - Close All             — collapse the strip back to dashboard + pinned
 *
 * Layout invariant: `[Dashboard, ...pinned, ...unpinned]`. Pinned
 * tabs render with a Pin badge in place of the close button — they
 * have to be unpinned before they can be closed via the X
 * affordance. Drag-to-reorder respects the pin/unpin boundary; an
 * attempted cross-zone drag falls through as a no-op so the user
 * knows pinning is an explicit gesture, not a side-effect of drag.
 *
 * Tabs preserve their full inner state (terminal sessions, log
 * filters, split panes, scroll positions) across switches because
 * the host renders all tabs in parallel and toggles visibility with
 * `display: none`. The bar itself is purely the addressing surface
 * — no per-tab state lives here.
 *
 * The bar is hidden when only the dashboard tab is open: a single
 * always-visible "Dashboard" pill carries no information the
 * sidebar's home button doesn't already convey, and pinning it
 * there would steal a row of vertical space from the dashboard for
 * no functional gain. As soon as a second tab opens we surface the
 * strip so the user can navigate between them.
 */
export function MainTabBar() {
  const tabs = useAppStore((s) => s.mainTabs);
  const activeKey = useAppStore((s) => s.activeMainTabKey);
  const services = useAppStore((s) => s.services);
  const stacks = useAppStore((s) => s.stacks);
  const statuses = useAppStore((s) => s.statuses);
  const pinnedKeys = useAppStore((s) => s.pinnedMainTabKeys);
  const setActiveMainTab = useAppStore((s) => s.setActiveMainTab);
  const closeMainTab = useAppStore((s) => s.closeMainTab);
  const closeOtherMainTabs = useAppStore((s) => s.closeOtherMainTabs);
  const closeMainTabsToRight = useAppStore((s) => s.closeMainTabsToRight);
  const closeMainTabsToLeft = useAppStore((s) => s.closeMainTabsToLeft);
  const closeAllMainTabs = useAppStore((s) => s.closeAllMainTabs);
  const toggleMainTabPin = useAppStore((s) => s.toggleMainTabPin);
  const reorderMainTabs = useAppStore((s) => s.reorderMainTabs);
  const moveMainTabLeft = useAppStore((s) => s.moveMainTabLeft);
  const moveMainTabRight = useAppStore((s) => s.moveMainTabRight);

  // Right-click context menu state. The targeted key is whatever tab
  // the user right-clicked — *not* the active tab, because the user
  // might be right-clicking an inactive tab to bulk-close around it
  // without first losing their place. Storing position alongside lets
  // FileContextMenu render at exact cursor coordinates and auto-flip
  // near viewport edges.
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  // Refs we need to wire up the scroll behaviour: the strip itself
  // (for wheel-to-horizontal translation and overflow detection) and
  // the active tab element (so we can scrollIntoView when the user
  // jumps to a tab that's currently off-screen).
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether content actually overflows on either side. Drives
  // the soft fade masks at the strip edges — we only paint a fade
  // when there's something hidden in that direction, so a strip
  // that fits comfortably stays clean.
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Translate vertical wheel scroll into horizontal scroll on the
  // tab strip. Users with regular mouse wheels (no shift modifier
  // muscle memory) expect "spin wheel = move sideways" on a
  // horizontal-overflow surface — VSCode, Chrome's tab bar, and the
  // file path breadcrumb in most IDEs all behave this way. We only
  // hijack the wheel when the strip actually has hidden content,
  // otherwise a stationary `preventDefault` would feel unresponsive
  // (the page wouldn't scroll either) on the dashboard's calmer
  // layouts.
  //
  // Note: trackpad horizontal swipes already produce `deltaX` —
  // those we leave alone (they hit the native scroll). The
  // translation only kicks in when `deltaX` is ~0 and the user is
  // wheeling vertically.
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    const horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (horizontalIntent) return;
    if (e.deltaY === 0) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  // Recompute the edge-fade flags on scroll / resize / tab-list
  // change. Cheap (two reads against the strip's scroll geometry),
  // and the result is a 2-bit bool so subscribers don't churn.
  const recomputeOverflow = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    recomputeOverflow();
    const onScroll = () => recomputeOverflow();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => recomputeOverflow());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [recomputeOverflow]);

  // When the active tab changes, scroll it into view if it's
  // off-screen. `block: 'nearest'` and `inline: 'nearest'` together
  // mean: do nothing if the tab is already fully visible (no
  // jitter on tab clicks that don't need scrolling), and slide the
  // minimum amount otherwise. Clicking a tab that's already on
  // screen never moves the strip — only programmatic activations
  // (sidebar click, store-driven snap on close) trigger movement.
  useEffect(() => {
    const el = activeTabRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  // Re-evaluate overflow flags whenever the tab list itself
  // changes (open / close / reorder affects scrollWidth without
  // firing a scroll event of its own).
  useEffect(() => {
    recomputeOverflow();
  }, [tabs, recomputeOverflow]);

  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);

  // Resolve display metadata once per render. Tabs whose backing
  // entity has been deleted (race between IPC roster sync and the
  // tab strip subscriber) fall through to "Unknown" so we never
  // crash on a missing service — the tab will be cleaned up on the
  // next store tick anyway.
  const items = useMemo(
    () =>
      tabs.map((tab) => {
        const key = mainTabKey(tab);
        return {
          tab,
          key,
          pinned: key !== DASHBOARD_TAB_KEY && pinnedSet.has(key),
          ...resolveTabMeta(tab, services, stacks, statuses),
        };
      }),
    [tabs, services, stacks, statuses, pinnedSet],
  );

  // Sortable item ids = every tab key EXCEPT the dashboard. The
  // dashboard renders outside the SortableContext so it's
  // structurally non-draggable AND a non-droppable target — no
  // amount of dragging can yank it out of the leftmost slot or
  // pop another tab in front of it.
  const sortableIds = useMemo(
    () => items.filter((it) => it.key !== DASHBOARD_TAB_KEY).map((it) => it.key),
    [items],
  );

  // PointerSensor with a small distance constraint so a plain click
  // on a tab still routes to `setActiveMainTab` — drag only kicks
  // in once the cursor moves >5px past the press point. KeyboardSensor
  // gives parity for users navigating via Tab+Space (a11y).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const overId = over ? String(over.id) : null;
      if (overId == null || activeId === overId) return;
      reorderMainTabs(activeId, overId);
    },
    [reorderMainTabs],
  );

  if (tabs.length <= 1) return null;

  const closeMenu = () => setMenu(null);

  // Compute zone-relative neighbour metadata for the right-clicked
  // tab so the menu can disable Move Left / Right entries when the
  // anchor is already at the edge of its zone (Chrome's tab bar
  // does this — saves the user from clicking a no-op).
  const zoneSiblings = (() => {
    if (!menu) return null;
    const idx = tabs.findIndex((t) => mainTabKey(t) === menu.key);
    if (idx < 0) return null;
    const isPinned = menu.key !== DASHBOARD_TAB_KEY && pinnedSet.has(menu.key);
    let canLeft = false;
    let canRight = false;
    const prev = tabs[idx - 1];
    const next = tabs[idx + 1];
    if (prev) {
      const prevKey = mainTabKey(prev);
      const prevIsPinned = prevKey !== DASHBOARD_TAB_KEY && pinnedSet.has(prevKey);
      canLeft = prevKey !== DASHBOARD_TAB_KEY && prevIsPinned === isPinned;
    }
    if (next) {
      const nextKey = mainTabKey(next);
      const nextIsPinned = nextKey !== DASHBOARD_TAB_KEY && pinnedSet.has(nextKey);
      canRight = nextIsPinned === isPinned;
    }
    return { canLeft, canRight, isPinned };
  })();

  // Build the menu lazily, gated on the right-clicked tab's
  // position. Each option disables itself when it would be a no-op
  // — keeps the menu honest instead of letting users click into
  // dead options. The `hint` slot doubles as a "how many tabs
  // would this close?" preview so the user can see the cost before
  // committing.
  const buildMenuItems = (): FileContextMenuEntry[] | null => {
    if (!menu || !zoneSiblings) return null;
    const idx = tabs.findIndex((t) => mainTabKey(t) === menu.key);
    if (idx < 0) return null;
    const isDashboard = menu.key === DASHBOARD_TAB_KEY;
    const total = tabs.length;
    const tabsToRight = total - idx - 1;
    // Tabs strictly to the left of `idx`, *excluding* the dashboard
    // (which never closes). For a right-click on the dashboard
    // itself this is naturally 0.
    const tabsToLeft = tabs.slice(0, idx).filter((t) => mainTabKey(t) !== DASHBOARD_TAB_KEY).length;
    // "Close Others" closes every non-pinned, non-dashboard tab
    // that isn't the anchor. Pinned tabs survive bulk-close
    // gestures, so they don't count toward the preview either.
    const othersCount = tabs.filter((t) => {
      const k = mainTabKey(t);
      if (k === menu.key) return false;
      if (k === DASHBOARD_TAB_KEY) return false;
      if (pinnedSet.has(k)) return false;
      return true;
    }).length;
    const closeAllCount = tabs.filter((t) => {
      const k = mainTabKey(t);
      if (k === DASHBOARD_TAB_KEY) return false;
      if (pinnedSet.has(k)) return false;
      return true;
    }).length;

    const entries: FileContextMenuEntry[] = [
      {
        id: 'pin',
        label: zoneSiblings.isPinned ? 'Unpin Tab' : 'Pin Tab',
        icon: zoneSiblings.isPinned ? <PinOff size={12} /> : <Pin size={12} />,
        // Dashboard can't be pinned/unpinned — it's already in its
        // own permanent zone, more sticky than any pinned tab.
        disabled: isDashboard,
        onClick: () => {
          toggleMainTabPin(menu.key);
          closeMenu();
        },
      },
      {
        id: 'move-left',
        label: 'Move Left',
        icon: <ArrowLeft size={12} />,
        disabled: isDashboard || !zoneSiblings.canLeft,
        onClick: () => {
          moveMainTabLeft(menu.key);
          closeMenu();
        },
      },
      {
        id: 'move-right',
        label: 'Move Right',
        icon: <ArrowRight size={12} />,
        disabled: isDashboard || !zoneSiblings.canRight,
        onClick: () => {
          moveMainTabRight(menu.key);
          closeMenu();
        },
      },
      { id: 'sep-pin', separator: true },
      {
        id: 'close',
        label: 'Close',
        icon: <X size={12} />,
        // Dashboard is the only tab that can't be individually
        // closed. We surface it as a disabled row instead of
        // hiding it so the menu's vertical rhythm stays the same
        // wherever the user right-clicks — predictable beats
        // tidy.
        disabled: isDashboard,
        onClick: () => {
          closeMainTab(menu.key);
          closeMenu();
        },
      },
      {
        id: 'close-others',
        label: 'Close Others',
        icon: <ListX size={12} />,
        disabled: othersCount === 0,
        hint: othersCount > 0 ? String(othersCount) : undefined,
        onClick: () => {
          closeOtherMainTabs(menu.key);
          closeMenu();
        },
      },
      {
        id: 'close-to-right',
        label: 'Close to the Right',
        icon: <ChevronsRight size={12} />,
        disabled: tabsToRight === 0,
        hint: tabsToRight > 0 ? String(tabsToRight) : undefined,
        onClick: () => {
          closeMainTabsToRight(menu.key);
          closeMenu();
        },
      },
      {
        id: 'close-to-left',
        label: 'Close to the Left',
        icon: <ChevronsLeft size={12} />,
        disabled: tabsToLeft === 0,
        hint: tabsToLeft > 0 ? String(tabsToLeft) : undefined,
        onClick: () => {
          closeMainTabsToLeft(menu.key);
          closeMenu();
        },
      },
      { id: 'sep-1', separator: true },
      {
        id: 'close-all',
        label: 'Close All',
        icon: <Trash2 size={12} />,
        // "Close All" still preserves the dashboard plus any
        // pinned tabs, so the affordance is meaningful only when
        // there's at least one closable (non-pinned) tab open.
        disabled: closeAllCount === 0,
        hint: closeAllCount > 0 ? String(closeAllCount) : undefined,
        tone: 'danger',
        onClick: () => {
          closeAllMainTabs();
          closeMenu();
        },
      },
    ];
    return entries;
  };

  const menuItems = buildMenuItems();

  const dashboardItem = items.find((it) => it.key === DASHBOARD_TAB_KEY) ?? null;
  const sortableItems = items.filter((it) => it.key !== DASHBOARD_TAB_KEY);

  return (
    <>
      <div className="border-border/70 bg-surface-raised relative flex h-9 shrink-0 border-b">
        {/* Soft fade masks at either end signal "more tabs in this
            direction" without taking up a column slot of their own.
            They're pointer-events-none so they never swallow clicks
            on the leftmost/rightmost tab; opacity flips off when the
            strip is fully scrolled to that edge so the tab sitting
            against the edge isn't permanently dimmed. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-10 w-6 transition-opacity',
            overflow.left ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            background:
              'linear-gradient(to right, rgb(var(--surface-raised)) 30%, rgb(var(--surface-raised) / 0))',
          }}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 z-10 w-6 transition-opacity',
            overflow.right ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            background:
              'linear-gradient(to left, rgb(var(--surface-raised)) 30%, rgb(var(--surface-raised) / 0))',
          }}
        />
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Open tabs"
          onWheel={onWheel}
          className="main-tabbar-scroll flex flex-1 items-stretch overflow-x-auto overflow-y-hidden"
        >
          {dashboardItem && (
            // Render the dashboard as a static tab outside the
            // SortableContext. Keeping it out of the dnd graph
            // means it can't be picked up, can't be dropped onto,
            // and the leftmost-slot invariant holds without us
            // having to police it inside drag handlers.
            <DashboardTab
              isActive={dashboardItem.key === activeKey}
              activeTabRef={dashboardItem.key === activeKey ? activeTabRef : undefined}
              onActivate={() => setActiveMainTab(dashboardItem.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ key: dashboardItem.key, x: e.clientX, y: e.clientY });
              }}
              icon={dashboardItem.icon}
              label={dashboardItem.label}
            />
          )}
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
              {sortableItems.map(({ tab, key, pinned, label, icon, status, closable }) => {
                const isActive = key === activeKey;
                return (
                  <SortableTab
                    key={key}
                    id={key}
                    tab={tab}
                    label={label}
                    icon={icon}
                    status={status}
                    isPinned={pinned}
                    pinnedSet={pinnedSet}
                    closable={closable}
                    isActive={isActive}
                    activeTabRef={isActive ? activeTabRef : undefined}
                    onActivate={() => setActiveMainTab(key)}
                    onClose={closable ? () => closeMainTab(key) : undefined}
                    onTogglePin={() => toggleMainTabPin(key)}
                    onContextMenu={(e) => {
                      // Stop propagation so the global app context
                      // menu (the one that lists "New Service / New
                      // Stack / Reload" via `useContextMenu` in
                      // App.tsx) doesn't pop in over our tab-aware
                      // one. Without this, right-clicking a tab
                      // opened the workspace menu because tabs sit
                      // inside the same tree the global handler is
                      // attached to.
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ key, x: e.clientX, y: e.clientY });
                    }}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      </div>
      {menu && menuItems && (
        <FileContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </>
  );
}

interface DashboardTabProps {
  isActive: boolean;
  activeTabRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  icon: React.ReactNode;
  label: string;
}

/**
 * Static, non-draggable dashboard tab. Mirrors `SortableTab`'s
 * visuals exactly except for the close-button slot (a transparent
 * spacer instead of a real button) so the strip has consistent
 * rhythm — without the spacer the dashboard tab would be ~16px
 * narrower than its siblings.
 */
function DashboardTab(props: DashboardTabProps) {
  const { isActive, activeTabRef, onActivate, onContextMenu, icon, label } = props;
  return (
    <div
      ref={activeTabRef}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-2 border-r px-3 text-[12px] transition select-none',
        'border-border/60 outline-none focus-visible:outline-none',
        isActive ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
      )}
      title="Workspace dashboard"
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition',
          isActive ? 'bg-accent' : 'bg-transparent',
        )}
      />
      <span className="text-fg-dim flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="max-w-[180px] truncate">{label}</span>
      {/* Spacer matches the close-button slot in SortableTab so all
          tabs keep the same width regardless of whether they show a
          close button. */}
      <span aria-hidden className="-mr-1 ml-1 inline-block h-4 w-4 shrink-0" />
    </div>
  );
}

interface SortableTabProps {
  id: string;
  tab: MainTab;
  label: string;
  icon: React.ReactNode;
  status?: Status;
  isPinned: boolean;
  /**
   * Whole pinned-key set, passed in so the tab can resolve the
   * *active drag's* zone without re-subscribing to the store. We
   * need this to decide whether to paint a drop-indicator on hover:
   * cross-zone hovers are rejected by `reorderMainTabs` in the
   * store, so signalling them visually as targets would mislead
   * the user.
   */
  pinnedSet: ReadonlySet<string>;
  closable: boolean;
  isActive: boolean;
  activeTabRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
  onActivate: () => void;
  onClose?: () => void;
  onTogglePin: () => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * A draggable tab. `useSortable` wires up the dnd-kit hooks; we let
 * the entire tab body act as the drag handle (spreading `listeners`
 * + `attributes` onto the root div) so the user doesn't have to
 * find a tiny grip — Chrome / VSCode tabs work the same way. The
 * `activationConstraint.distance` configured on the PointerSensor
 * ensures plain clicks (which never cross 5px) still fire onClick
 * for tab activation; only meaningful drags initiate a sort.
 *
 * The close-button slot is replaced by a Pin badge for pinned
 * tabs. Clicking the badge unpins (instead of closing) — matches
 * Chrome / Firefox behaviour: pinned tabs require an explicit
 * unpin step before they can be closed via the X / middle-click.
 */
function SortableTab(props: SortableTabProps) {
  const {
    id,
    tab,
    label,
    icon,
    status,
    isPinned,
    pinnedSet,
    closable,
    isActive,
    activeTabRef,
    onActivate,
    onClose,
    onTogglePin,
    onContextMenu,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } =
    useSortable({ id });

  // Resolve the active drag's identity / zone so we can decide
  // whether to paint a drop-indicator on this tab. Cross-zone
  // drops are silently rejected by `reorderMainTabs` in the store
  // (pinning is an explicit gesture), so flagging cross-zone
  // hovers as targets would mislead the user — better to render
  // nothing and have the strip read as "no, you can't drop there"
  // by absence of feedback.
  const activeId = active?.id != null ? String(active.id) : null;
  const isDragSource = activeId === id;
  const activeIsPinned =
    activeId != null && activeId !== DASHBOARD_TAB_KEY && pinnedSet.has(activeId);
  const sameZoneDrag = activeId != null && activeIsPinned === isPinned;
  // Drop indicator only when ALL of: there's a live drag, this
  // tab isn't the source, and the source/target zones match.
  // dnd-kit's `isOver` flips on for any tab whose center the
  // cursor is closest to — including the source itself early in
  // the drag — so we gate on `!isDragSource` to avoid the
  // confusing "I'm dragging tab X and tab X is shown as the drop
  // target" effect the user reported.
  const showDropIndicator = isOver && !isDragSource && sameZoneDrag;

  // Compose only the bits dnd-kit actually needs at any given moment:
  //
  //   • `transform`  — present whenever the tab is moving (active
  //                    drag or sortable shift to make room).
  //   • `transition` — provided by dnd-kit only when a slide
  //                    animation should run. We DON'T set a `'0ms'`
  //                    fallback at rest because inline `transition`
  //                    overrides the className `transition` and
  //                    that would silently kill hover / active-bar
  //                    color animations.
  //   • `zIndex`     — only the active-drag tab needs to lift above
  //                    siblings so its shadow paints cleanly.
  //   • `boxShadow`  — soft drop shadow on the dragged tab to read
  //                    as "I'm picking this up". Distinguishes the
  //                    dragged ghost from the neighbours that
  //                    slide into place behind it.
  const style: React.CSSProperties = {
    ...(transform ? { transform: CSS.Transform.toString(transform) } : null),
    ...(transition ? { transition } : null),
    ...(isDragging
      ? {
          zIndex: 20,
          boxShadow: '0 6px 16px rgb(0 0 0 / 0.22), 0 2px 4px rgb(0 0 0 / 0.18)',
        }
      : null),
  };

  // Compose ref so dnd-kit's setNodeRef and the parent's
  // activeTabRef (used to scroll the active tab into view) both
  // hit the same DOM node.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (activeTabRef) {
        (activeTabRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [setNodeRef, activeTabRef],
  );

  return (
    <div
      ref={setRefs}
      style={style}
      // Spread dnd-kit's a11y attributes / pointer listeners FIRST
      // so the explicit `role`/`tabIndex`/`aria-selected` below
      // override them. dnd-kit defaults `role` to "button" for
      // sortable items, but our tabs are tabs (the parent has
      // `role="tablist"`) — keeping "tab" is what screen readers
      // expect for tabs-with-roving-focus.
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
        if (closable && !isPinned && (e.key === 'Backspace' || e.key === 'Delete')) {
          e.preventDefault();
          onClose?.();
        }
      }}
      onAuxClick={(e) => {
        // Middle-click closes the tab — same affordance as VSCode /
        // Chrome / Firefox. Pinned tabs ignore middle-click on
        // purpose: the user has to unpin first, mirroring browser
        // behaviour.
        if (e.button === 1 && closable && !isPinned) {
          e.preventDefault();
          onClose?.();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-2 border-r px-3 text-[12px] transition select-none',
        'border-border/60 outline-none focus-visible:outline-none',
        isActive ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
        // Source ghost. Previously the dragged tab showed a soft
        // accent ring that read like a drop-target highlight —
        // confusing because the source isn't a target. We now
        // fade it to a translucent ghost (the box-shadow set in
        // `style` carries the lift), and `cursor-grabbing` keeps
        // the gesture explicit. No ring, no border on the source.
        isDragging && 'cursor-grabbing opacity-40',
        // Drop target wash. Soft ~8% accent tint on the tab the
        // cursor is currently over — *only* when it's a valid
        // drop (different tab, same zone). The vertical accent
        // bar rendered below carries the precise "where it'll
        // land" signal; this background is just the ambient
        // confirmation that the slot accepts the drop.
        showDropIndicator && 'bg-accent/8',
      )}
      title={tab.kind === 'dashboard' ? 'Workspace dashboard' : label}
    >
      {/* Active indicator: a thin accent bar pinned to the top of
          the tab. Mirrors VSCode's active-tab signal. The inactive
          tab leaves the slot transparent so the surface stays calm;
          only the active tab earns the line. The bar dims while
          THIS tab is the drag source so the ghost reads as a
          held-up tab, not an active one being yanked around. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition',
          isActive ? 'bg-accent' : 'bg-transparent',
          isDragging && 'opacity-50',
        )}
      />
      {/* Drop-indicator: a thin vertical accent bar on the leading
          (left) edge of the target tab. The store inserts the
          dragged tab BEFORE the drop target's index, so the left
          edge is the precise insertion point. We anchor it just
          outside the previous tab's right border (`-left-px`) so
          it visually bridges the gap between two tabs instead of
          looking glued to one side. The accent halo (box-shadow)
          is the "net efekt" the user asked for — louder than a
          plain inset ring and unmistakable as "drop here", while
          the surrounding tab stays calm with only the soft 8%
          accent wash. */}
      {showDropIndicator && (
        <span
          aria-hidden
          className="bg-accent pointer-events-none absolute inset-y-1 -left-px z-10 w-[2px] rounded-full"
          style={{
            boxShadow: '0 0 6px 1px rgb(var(--accent) / 0.55), 0 0 2px 0 rgb(var(--accent) / 0.85)',
          }}
        />
      )}
      <span className="text-fg-dim flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {tab.kind === 'service' && status ? <StatusDot status={status} size="sm" /> : icon}
      </span>
      <span className="max-w-[180px] truncate">{label}</span>
      {isPinned ? (
        <button
          type="button"
          title="Unpin tab"
          aria-label={`Unpin ${label}`}
          onClick={(e) => {
            // Stop propagation so the click doesn't bubble up and
            // also fire the tab-activate handler. The pin badge is
            // a distinct affordance from "switch to this tab".
            e.stopPropagation();
            onTogglePin();
          }}
          // dnd-kit's listeners attached to the parent would treat
          // a press on this tiny button as the start of a drag;
          // pointer-down stop here keeps the badge single-purpose
          // (click = unpin, NOT click = drag).
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'text-accent hover:bg-surface-overlay -mr-1 ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] opacity-90 transition',
          )}
        >
          <Pin className="h-3 w-3 fill-current" />
        </button>
      ) : closable ? (
        <button
          type="button"
          title="Close tab"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          // Same drag-suppression as the pin badge: the close button
          // is its own gesture and shouldn't accidentally start a
          // drag on press.
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'text-fg-dim hover:bg-surface-overlay hover:text-fg -mr-1 ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] transition',
            isActive ? 'opacity-80' : 'opacity-0 group-hover:opacity-80',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        // Reserve the same horizontal slot the close button would
        // take so width matches its closable siblings — otherwise
        // the strip jiggles by ~16px when a non-closable tab opens.
        <span aria-hidden className="-mr-1 ml-1 inline-block h-4 w-4 shrink-0" />
      )}
    </div>
  );
}

interface TabMeta {
  label: string;
  icon: React.ReactNode;
  status?: Status;
  closable: boolean;
}

function resolveTabMeta(
  tab: MainTab,
  services: ReturnType<typeof useAppStore.getState>['services'],
  stacks: ReturnType<typeof useAppStore.getState>['stacks'],
  statuses: ReturnType<typeof useAppStore.getState>['statuses'],
): TabMeta {
  if (tab.kind === 'dashboard') {
    return {
      label: 'Dashboard',
      icon: <LayoutDashboard className="h-3 w-3" />,
      closable: false,
    };
  }
  if (tab.kind === 'service') {
    const svc = services.find((s) => s.id === tab.refId);
    return {
      label: svc?.name ?? 'Unknown service',
      icon: null,
      status: (statuses[tab.refId]?.status ?? 'stopped') as Status,
      closable: true,
    };
  }
  const stack = stacks.find((s) => s.id === tab.refId);
  return {
    label: stack?.name ?? 'Unknown stack',
    icon: <Layers className="h-3 w-3" />,
    closable: true,
  };
}

// Re-export the home-tab key so other surfaces (sidebar Dashboard
// button, breadcrumb back-links) can address it without
// re-deriving the composite key string.
export { DASHBOARD_TAB_KEY };
