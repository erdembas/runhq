import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
  ListX,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import type { FileContextMenuEntry } from '@/components/ui/FileContextMenu';
import { DASHBOARD_TAB_KEY, mainTabKey, type MainTab } from '@/store/useAppStore';

interface MainTabContextMenuArgs {
  tabs: MainTab[];
  pinnedSet: ReadonlySet<string>;
  closeMainTab: (key: string) => void;
  closeOtherMainTabs: (key: string) => void;
  closeMainTabsToRight: (key: string) => void;
  closeMainTabsToLeft: (key: string) => void;
  closeAllMainTabs: () => void;
  toggleMainTabPin: (key: string) => void;
  moveMainTabLeft: (key: string) => void;
  moveMainTabRight: (key: string) => void;
}

interface MainTabContextMenuState {
  key: string;
  x: number;
  y: number;
}

export function useMainTabContextMenu(args: MainTabContextMenuArgs) {
  const {
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
  } = args;
  const [menu, setMenu] = useState<MainTabContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((key: string, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ key, x: event.clientX, y: event.clientY });
  }, []);

  const zoneSiblings = useMemo(() => {
    if (!menu) return null;

    const index = tabs.findIndex((tab) => mainTabKey(tab) === menu.key);
    if (index < 0) return null;

    const isPinned = menu.key !== DASHBOARD_TAB_KEY && pinnedSet.has(menu.key);
    const prev = tabs[index - 1];
    const next = tabs[index + 1];
    const prevKey = prev ? mainTabKey(prev) : null;
    const nextKey = next ? mainTabKey(next) : null;
    const prevIsPinned = prevKey != null && prevKey !== DASHBOARD_TAB_KEY && pinnedSet.has(prevKey);
    const nextIsPinned = nextKey != null && nextKey !== DASHBOARD_TAB_KEY && pinnedSet.has(nextKey);

    return {
      isPinned,
      canLeft: prevKey != null && prevKey !== DASHBOARD_TAB_KEY && prevIsPinned === isPinned,
      canRight: nextKey != null && nextIsPinned === isPinned,
    };
  }, [menu, pinnedSet, tabs]);

  const menuItems = useMemo<FileContextMenuEntry[] | null>(() => {
    if (!menu || !zoneSiblings) return null;

    const index = tabs.findIndex((tab) => mainTabKey(tab) === menu.key);
    if (index < 0) return null;

    const isDashboard = menu.key === DASHBOARD_TAB_KEY;
    const tabsToRight = tabs.length - index - 1;
    const tabsToLeft = tabs
      .slice(0, index)
      .filter((tab) => mainTabKey(tab) !== DASHBOARD_TAB_KEY).length;
    const othersCount = tabs.filter((tab) => {
      const key = mainTabKey(tab);
      return key !== menu.key && key !== DASHBOARD_TAB_KEY && !pinnedSet.has(key);
    }).length;
    const closeAllCount = tabs.filter((tab) => {
      const key = mainTabKey(tab);
      return key !== DASHBOARD_TAB_KEY && !pinnedSet.has(key);
    }).length;

    return [
      {
        id: 'pin',
        label: zoneSiblings.isPinned ? 'Unpin Tab' : 'Pin Tab',
        icon: zoneSiblings.isPinned ? <PinOff size={12} /> : <Pin size={12} />,
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
        disabled: closeAllCount === 0,
        hint: closeAllCount > 0 ? String(closeAllCount) : undefined,
        tone: 'danger',
        onClick: () => {
          closeAllMainTabs();
          closeMenu();
        },
      },
    ];
  }, [
    closeAllMainTabs,
    closeMainTab,
    closeMainTabsToLeft,
    closeMainTabsToRight,
    closeMenu,
    closeOtherMainTabs,
    menu,
    moveMainTabLeft,
    moveMainTabRight,
    pinnedSet,
    tabs,
    toggleMainTabPin,
    zoneSiblings,
  ]);

  return { menu, menuItems, openMenu, closeMenu };
}
