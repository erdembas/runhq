import { useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { getServiceShortcuts } from '@/lib/serviceShortcutBus';
import { useViewShortcuts, type ViewShortcutHandlers } from '@/lib/useViewShortcuts';
import { mainTabKey, useAppStore } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';

export function useAppViewShortcuts() {
  const settingsCategory = useAppStore((s) => s.settingsCategory);
  const toggleSidebarPinned = useAppStore((s) => s.toggleSidebarPinned);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const closeMainTab = useAppStore((s) => s.closeMainTab);
  const setActiveMainTab = useAppStore((s) => s.setActiveMainTab);
  const viewShortcuts = useShellUiStore((s) => s.viewShortcuts);
  const setViewShortcuts = useShellUiStore((s) => s.setViewShortcuts);

  useEffect(() => {
    if (settingsCategory !== null) return;

    let cancelled = false;
    ipc
      .getPrefs()
      .then((prefs) => {
        if (!cancelled) setViewShortcuts(prefs.shortcuts ?? null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [settingsCategory, setViewShortcuts]);

  const viewHandlers: ViewShortcutHandlers = {
    toggle_left_sidebar: () => toggleSidebarPinned(),
    toggle_ai_panel: () => toggleRightPanel('ai'),
    toggle_activity_panel: () => toggleRightPanel('activity'),
    new_terminal: () => {
      const state = useAppStore.getState();
      const active = state.mainTabs.find((tab) => mainTabKey(tab) === state.activeMainTabKey);
      if (!active || active.kind !== 'service') return;
      getServiceShortcuts(active.refId)?.newTerminal();
    },
    next_main_tab: () => {
      const state = useAppStore.getState();
      const tabs = state.mainTabs;
      if (tabs.length <= 1) return;

      const index = tabs.findIndex((tab) => mainTabKey(tab) === state.activeMainTabKey);
      const target = tabs[index < 0 ? 0 : (index + 1) % tabs.length];
      if (target) setActiveMainTab(mainTabKey(target));
    },
    prev_main_tab: () => {
      const state = useAppStore.getState();
      const tabs = state.mainTabs;
      if (tabs.length <= 1) return;

      const index = tabs.findIndex((tab) => mainTabKey(tab) === state.activeMainTabKey);
      const target = tabs[index <= 0 ? tabs.length - 1 : index - 1];
      if (target) setActiveMainTab(mainTabKey(target));
    },
    close_main_tab: () => {
      const key = useAppStore.getState().activeMainTabKey;
      if (key && key !== 'dashboard') closeMainTab(key);
    },
  };

  useViewShortcuts(viewShortcuts, viewHandlers);
}
