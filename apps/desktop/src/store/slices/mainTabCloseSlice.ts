import { DASHBOARD_TAB, DASHBOARD_TAB_KEY, mainTabKey } from '@/store/appStoreTypes';
import { reconcileOverlayTabFlags } from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createMainTabCloseSlice: AppStoreSlice = (set) => ({
  closeOtherMainTabs: (keepKey) =>
    set((s) => {
      // The dashboard tab is sticky regardless of which tab the user
      // anchored on — closing it would leave them with no home base.
      // We also preserve pinned tabs (Chrome / Firefox parity:
      // bulk-close gestures never touch what the user explicitly
      // pinned).
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const next = s.mainTabs.filter((t) => {
        const k = mainTabKey(t);
        return k === keepKey || k === DASHBOARD_TAB_KEY || pinnedSet.has(k);
      });
      if (next.length === s.mainTabs.length) return s;
      // Anchor becomes active so the user lands somewhere meaningful.
      // If they right-clicked the dashboard itself, active stays on
      // dashboard naturally because it's the only candidate.
      const activeKey = next.some((t) => mainTabKey(t) === keepKey) ? keepKey : DASHBOARD_TAB_KEY;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeMainTabsToRight: (key) =>
    set((s) => {
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      // Already the rightmost tab — nothing to close.
      if (idx === s.mainTabs.length - 1) return s;
      // Keep everything up to (and including) the anchor, plus any
      // pinned tab that lived to the right of it. With the
      // [Dashboard, ...pinned, ...unpinned] invariant the right-of-
      // anchor pinned tabs only exist when the anchor itself is
      // pinned (or dashboard); preserving them here matches the
      // user's "pinning protects from bulk-close" expectation.
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const head = s.mainTabs.slice(0, idx + 1);
      const tail = s.mainTabs.slice(idx + 1).filter((t) => pinnedSet.has(mainTabKey(t)));
      const next = [...head, ...tail];
      // If the active tab survived the cut, leave it where it is —
      // closing tabs the user wasn't even looking at shouldn't
      // disturb their place. Otherwise snap to the anchor so we
      // don't leave them on a closed tab's empty slot.
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : key;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeMainTabsToLeft: (key) =>
    set((s) => {
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      // Anchor is already the leftmost tab — nothing to close.
      // (In practice this means the dashboard, which is always at
      // idx 0; the menu disables the option in that case but the
      // store still guards.)
      if (idx === 0) return s;
      // Keep the dashboard pinned at index 0 plus everything from
      // the anchor onward, AND every user-pinned tab to the left
      // of the anchor (preserving its original relative order).
      // The dashboard re-emerges left of the anchor automatically
      // because it's the only survivor below `idx` once pinned
      // tabs are folded back in. If somehow the dashboard wasn't
      // there, we still append it at the front to satisfy the
      // "always present" invariant.
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const headPinned = s.mainTabs.slice(0, idx).filter((t) => pinnedSet.has(mainTabKey(t)));
      const tail = s.mainTabs.slice(idx);
      const next = tail.some((t) => mainTabKey(t) === DASHBOARD_TAB_KEY)
        ? [...headPinned, ...tail]
        : [DASHBOARD_TAB, ...headPinned, ...tail];
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : key;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
  closeAllMainTabs: () =>
    set((s) => {
      // Pinned tabs survive a "Close All" — that's the whole point
      // of pinning. Build the kept list as `[Dashboard, ...pinned]`
      // (in their existing relative order so the user's manual
      // arrangement isn't shuffled).
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const kept = s.mainTabs.filter(
        (t) => mainTabKey(t) === DASHBOARD_TAB_KEY || pinnedSet.has(mainTabKey(t)),
      );
      const next = kept.some((t) => mainTabKey(t) === DASHBOARD_TAB_KEY)
        ? kept
        : [DASHBOARD_TAB, ...kept];
      // Already at the kept set — no need to dirty state.
      if (next.length === s.mainTabs.length) return s;
      const activeStillOpen = next.some((t) => mainTabKey(t) === s.activeMainTabKey);
      const activeKey = activeStillOpen ? s.activeMainTabKey : DASHBOARD_TAB_KEY;
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId: activeTab?.kind === 'service' ? activeTab.refId : null,
        selectedStackId: activeTab?.kind === 'stack' ? activeTab.refId : null,
        selectedCmdName: null,
        ...reconcileOverlayTabFlags(s, next),
      };
    }),
});
