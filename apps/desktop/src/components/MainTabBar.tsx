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
} from '@dnd-kit/sortable';
import { DashboardTab } from '@/components/main-tab-bar/DashboardTab';
import { SortableTab } from '@/components/main-tab-bar/SortableTab';
import { resolveTabMeta } from '@/components/main-tab-bar/tabMeta';
import { useMainTabContextMenu } from '@/components/main-tab-bar/useMainTabContextMenu';
import { FileContextMenu } from '@/components/ui/FileContextMenu';
import { DASHBOARD_TAB_KEY, mainTabKey, useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

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

  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);
  const { menu, menuItems, openMenu, closeMenu } = useMainTabContextMenu({
    tabs,
    pinnedSet,
    closeMainTab,
    closeOtherMainTabs,
    closeMainTabsToRight,
    closeMainTabsToLeft,
    closeAllMainTabs,
    toggleMainTabPin,
    moveMainTabLeft,
    moveMainTabRight,
  });

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const element = stripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;

    event.preventDefault();
    element.scrollLeft += event.deltaY;
  }, []);

  const recomputeOverflow = useCallback(() => {
    const element = stripRef.current;
    if (!element) return;

    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;

    recomputeOverflow();
    const onScroll = () => recomputeOverflow();
    const resizeObserver = new ResizeObserver(() => recomputeOverflow());
    element.addEventListener('scroll', onScroll, { passive: true });
    resizeObserver.observe(element);

    return () => {
      element.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, [recomputeOverflow]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [activeKey]);

  useEffect(() => {
    recomputeOverflow();
  }, [recomputeOverflow, tabs]);

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
    [pinnedSet, services, stacks, statuses, tabs],
  );

  const sortableIds = useMemo(
    () => items.filter((item) => item.key !== DASHBOARD_TAB_KEY).map((item) => item.key),
    [items],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (overId == null || activeId === overId) return;
      reorderMainTabs(activeId, overId);
    },
    [reorderMainTabs],
  );

  if (tabs.length <= 1) return null;

  const dashboardItem = items.find((item) => item.key === DASHBOARD_TAB_KEY) ?? null;
  const sortableItems = items.filter((item) => item.key !== DASHBOARD_TAB_KEY);

  return (
    <>
      <div className="border-border/70 bg-surface-raised relative flex h-9 shrink-0 border-b">
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
            <DashboardTab
              isActive={dashboardItem.key === activeKey}
              activeTabRef={dashboardItem.key === activeKey ? activeTabRef : undefined}
              onActivate={() => setActiveMainTab(dashboardItem.key)}
              onContextMenu={(event) => openMenu(dashboardItem.key, event)}
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
                    onContextMenu={(event) => openMenu(key, event)}
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

export { DASHBOARD_TAB_KEY };
