import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Layers,
  ListX,
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
 * Horizontal tab strip rendered at the top of the main content area.
 *
 * Each open service / stack lives as its own tab; the dashboard sits
 * at the leftmost slot as a permanent "home" tab that cannot be
 * closed individually. Clicking a tab activates it via
 * {@link setActiveMainTab}; clicking the small × on hover (or
 * middle-clicking) closes it. Right-clicking surfaces a VSCode-style
 * context menu with bulk-close affordances:
 *
 *   - Close                 — close just this tab
 *   - Close Others          — keep this tab + dashboard, close everything else
 *   - Close to the Right    — close every tab strictly after the anchor
 *   - Close to the Left     — close every tab between dashboard and anchor
 *   - Close All             — collapse the strip back to just the dashboard
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
  const setActiveMainTab = useAppStore((s) => s.setActiveMainTab);
  const closeMainTab = useAppStore((s) => s.closeMainTab);
  const closeOtherMainTabs = useAppStore((s) => s.closeOtherMainTabs);
  const closeMainTabsToRight = useAppStore((s) => s.closeMainTabsToRight);
  const closeMainTabsToLeft = useAppStore((s) => s.closeMainTabsToLeft);
  const closeAllMainTabs = useAppStore((s) => s.closeAllMainTabs);

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
  // changes (open / close affects scrollWidth without firing a
  // scroll event of its own).
  useEffect(() => {
    recomputeOverflow();
  }, [tabs, recomputeOverflow]);

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
          ...resolveTabMeta(tab, services, stacks, statuses),
        };
      }),
    [tabs, services, stacks, statuses],
  );

  if (tabs.length <= 1) return null;

  const closeMenu = () => setMenu(null);

  // Build the menu lazily, gated on the right-clicked tab's
  // position. Each option disables itself when it would be a no-op
  // — keeps the menu honest instead of letting users click into
  // dead options. The `hint` slot doubles as a "how many tabs
  // would this close?" preview so the user can see the cost before
  // committing.
  const buildMenuItems = (): FileContextMenuEntry[] | null => {
    if (!menu) return null;
    const idx = tabs.findIndex((t) => mainTabKey(t) === menu.key);
    if (idx < 0) return null;
    const isDashboard = menu.key === DASHBOARD_TAB_KEY;
    const total = tabs.length;
    const tabsToRight = total - idx - 1;
    // Tabs strictly to the left of `idx`, *excluding* the dashboard
    // (which never closes). For a right-click on the dashboard
    // itself this is naturally 0.
    const tabsToLeft = tabs.slice(0, idx).filter((t) => mainTabKey(t) !== DASHBOARD_TAB_KEY).length;
    // "Close Others" closes everything except dashboard + anchor —
    // count is total minus those two (or just minus 1 if the
    // anchor IS the dashboard).
    const othersCount = isDashboard ? total - 1 : Math.max(0, total - 2);

    const entries: FileContextMenuEntry[] = [
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
        // "Close All" still preserves the sticky dashboard, so the
        // affordance is meaningful only when there's at least one
        // other tab open.
        disabled: total <= 1,
        hint: total > 1 ? String(total - 1) : undefined,
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
          {items.map(({ tab, key, label, icon, status, closable }) => {
            const isActive = key === activeKey;
            const isMenuTarget = menu?.key === key;
            return (
              <div
                key={key}
                ref={isActive ? activeTabRef : undefined}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveMainTab(key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveMainTab(key);
                  }
                  if (closable && (e.key === 'Backspace' || e.key === 'Delete')) {
                    e.preventDefault();
                    closeMainTab(key);
                  }
                }}
                onAuxClick={(e) => {
                  // Middle-click closes the tab — same affordance as
                  // VSCode / Chrome / Firefox. Skip the dashboard
                  // which is sticky.
                  if (e.button === 1 && closable) {
                    e.preventDefault();
                    closeMainTab(key);
                  }
                }}
                onContextMenu={(e) => {
                  // Stop propagation so the global app context menu
                  // (the one that lists "New Service / New Stack /
                  // Reload" via `useContextMenu` in App.tsx) doesn't
                  // pop in over our tab-aware one. Without this,
                  // right-clicking a tab opened the workspace menu
                  // because tabs sit inside the same tree the
                  // global handler is attached to.
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ key, x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  'group relative flex shrink-0 cursor-pointer items-center gap-2 border-r px-3 text-[12px] transition select-none',
                  'border-border/60',
                  isActive
                    ? 'bg-surface text-fg'
                    : 'text-fg-muted hover:bg-surface/60 hover:text-fg',
                  isMenuTarget && 'ring-accent/40 ring-1 ring-inset',
                )}
                title={tab.kind === 'dashboard' ? 'Workspace dashboard' : label}
              >
                {/* Active indicator: a thin accent bar pinned to the top
                  of the tab. Mirrors VSCode's active-tab signal. The
                  inactive tab leaves the slot transparent so the
                  surface stays calm; only the active tab earns the
                  line. */}
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 h-[2px] transition',
                    isActive ? 'bg-accent' : 'bg-transparent',
                  )}
                />
                <span className="text-fg-dim flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {tab.kind === 'service' && status ? (
                    <StatusDot status={status} size="sm" />
                  ) : (
                    icon
                  )}
                </span>
                <span className="max-w-[180px] truncate">{label}</span>
                {closable ? (
                  <button
                    type="button"
                    title="Close tab"
                    aria-label={`Close ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeMainTab(key);
                    }}
                    className={cn(
                      'text-fg-dim hover:bg-surface-overlay hover:text-fg -mr-1 ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] transition',
                      isActive ? 'opacity-80' : 'opacity-0 group-hover:opacity-80',
                    )}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  // Reserve the same horizontal slot the close button
                  // would take so dashboard tab width matches its
                  // closable siblings — otherwise the strip jiggles
                  // by ~16px when a second tab opens for the first
                  // time.
                  <span aria-hidden className="-mr-1 ml-1 inline-block h-4 w-4 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {menu && menuItems && (
        <FileContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </>
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
