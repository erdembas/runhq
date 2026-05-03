import type { MainTab } from '@/store/appStoreTypes';
import {
  DASHBOARD_TAB,
  DASHBOARD_TAB_KEY,
  RELEASE_NOTES_TAB_KEY,
  SETTINGS_TAB_KEY,
  mainTabKey,
} from '@/store/appStoreTypes';
import {
  initialPinnedTabs,
  insertTabRespectingPin,
  isPinnedKey,
  pinBoundaryIndex,
  savePinnedTabs,
} from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';
import { createMainTabCloseSlice } from '@/store/slices/mainTabCloseSlice';

export const createMainTabSlice: AppStoreSlice = (set, get, api) => ({
  mainTabs: [DASHBOARD_TAB],
  activeMainTabKey: DASHBOARD_TAB_KEY,
  pinnedMainTabKeys: initialPinnedTabs,
  pendingServiceBodyTab: {},
  setSelected: (id) =>
    set((s) => {
      if (id == null) {
        return {
          selectedServiceId: null,
          selectedCmdName: null,
          selectedStackId: null,
          activeMainTabKey: DASHBOARD_TAB_KEY,
        };
      }
      const tab: MainTab = { kind: 'service', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      return {
        selectedServiceId: id,
        selectedCmdName: null,
        selectedStackId: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
      };
    }),
  openServiceWithBodyTab: (id, bodyTab) =>
    set((s) => {
      const tab: MainTab = { kind: 'service', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      // Same tab-routing logic as `setSelected(id)` but with the
      // body-tab request stamped onto `pendingServiceBodyTab` in
      // the same atomic update. Inlined rather than calling
      // `setSelected` first because we want a single store
      // transition — separating it would mean LogPanel could
      // mount on the freshly-opened tab BEFORE the body request
      // landed, race-losing back to the LOGS default and
      // clobbering the deep-link.
      return {
        selectedServiceId: id,
        selectedCmdName: null,
        selectedStackId: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
        pendingServiceBodyTab: { ...s.pendingServiceBodyTab, [id]: bodyTab },
      };
    }),
  consumePendingServiceBodyTab: (id) =>
    set((s) => {
      if (!(id in s.pendingServiceBodyTab)) return s;
      const next = { ...s.pendingServiceBodyTab };
      delete next[id];
      return { pendingServiceBodyTab: next };
    }),
  setSelectedCmd: (cmdName) => set({ selectedCmdName: cmdName }),
  setSelectedStack: (id) =>
    set((s) => {
      if (id == null) {
        return {
          selectedStackId: null,
          selectedServiceId: null,
          selectedCmdName: null,
          activeMainTabKey: DASHBOARD_TAB_KEY,
        };
      }
      const tab: MainTab = { kind: 'stack', refId: id };
      const key = mainTabKey(tab);
      const exists = s.mainTabs.some((t) => mainTabKey(t) === key);
      return {
        selectedStackId: id,
        selectedServiceId: null,
        selectedCmdName: null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, tab, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: key,
      };
    }),

  openMainTab: (tab) => {
    const key = mainTabKey(tab);
    if (tab.kind === 'service') {
      get().setSelected(tab.refId);
      return;
    }
    if (tab.kind === 'stack') {
      get().setSelectedStack(tab.refId);
      return;
    }
    set({
      activeMainTabKey: key,
      selectedServiceId: null,
      selectedStackId: null,
      selectedCmdName: null,
    });
  },
  closeMainTab: (key) =>
    set((s) => {
      // Dashboard is sticky — closing it would leave the user with no
      // home base. We silently no-op rather than throw so callers
      // (e.g. middle-click on the dashboard tab) don't have to guard.
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      const next = s.mainTabs.filter((_, i) => i !== idx);
      let activeKey = s.activeMainTabKey;
      if (s.activeMainTabKey === key) {
        // Snap to the tab that just shifted into the closed slot
        // (next[idx]); fall back to the left neighbour and finally
        // to the dashboard if nothing else is open. Mirrors the
        // chat-tab close behaviour above and the user's mental
        // model: closing tab N puts you on the new tab N (the one
        // that filled the gap), or on the previous tab if N was the
        // rightmost.
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        activeKey = fallback ? mainTabKey(fallback) : DASHBOARD_TAB_KEY;
      }
      const activeTab = next.find((t) => mainTabKey(t) === activeKey);
      const selectedServiceId = activeTab?.kind === 'service' ? activeTab.refId : null;
      const selectedStackId = activeTab?.kind === 'stack' ? activeTab.refId : null;
      // Settings / Release Notes flags shadow tab presence — when
      // their tab is the one being closed, blank the matching flag
      // so the rest of the app (sidebar highlights, prefs reload
      // effect in App.tsx) sees a consistent "not open" state.
      const closedSettings = key === SETTINGS_TAB_KEY;
      const closedReleaseNotes = key === RELEASE_NOTES_TAB_KEY;
      return {
        mainTabs: next,
        activeMainTabKey: activeKey,
        selectedServiceId,
        selectedStackId,
        selectedCmdName: null,
        ...(closedSettings && { settingsCategory: null }),
        ...(closedReleaseNotes && {
          releaseNotesOpen: false,
          releaseNotesSelectedVersion: null,
        }),
      };
    }),
  setActiveMainTab: (key) =>
    set((s) => {
      const tab = s.mainTabs.find((t) => mainTabKey(t) === key);
      if (!tab) return s;
      return {
        activeMainTabKey: key,
        selectedServiceId: tab.kind === 'service' ? tab.refId : null,
        selectedStackId: tab.kind === 'stack' ? tab.refId : null,
        selectedCmdName: null,
      };
    }),
  ...createMainTabCloseSlice(set, get, api),
  toggleMainTabPin: (key) =>
    set((s) => {
      // Dashboard is its own zone — already sticky in a stronger
      // sense than pinning. Silently no-op so callers (context-menu
      // entries, keyboard shortcuts) don't have to guard.
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0) return s;
      const tab = s.mainTabs[idx];
      if (!tab) return s;
      const isPinned = s.pinnedMainTabKeys.includes(key);
      // Build the post-pin tab list so the visual `[Dashboard,
      // ...pinned, ...unpinned]` invariant holds without us having
      // to do a second pass: yank the tab out, then re-insert at
      // the new zone's tail. Tail (rather than head) keeps the
      // most-recently-pinned tab next to the unpinned zone, which
      // matches Chrome's "newest pin lands rightmost in the pinned
      // strip" behaviour.
      const withoutTab = [...s.mainTabs.slice(0, idx), ...s.mainTabs.slice(idx + 1)];
      const nextPinned = isPinned
        ? s.pinnedMainTabKeys.filter((k) => k !== key)
        : [...s.pinnedMainTabKeys, key];
      const pinnedSetAfter = new Set(nextPinned);
      // For the tab-less array, `pinBoundaryIndex` returns the slot
      // right after the existing pinned tabs in either direction:
      //   • Pinning  → existing pinned tabs stay where they are; the
      //                newly pinned tab lands at boundary (= right
      //                edge of pinned zone, just before unpinned).
      //   • Unpinning→ remaining pinned tabs are the same ones
      //                minus this key; boundary points to the start
      //                of unpinned zone, which is exactly where the
      //                freshly unpinned tab should appear.
      const insertAt = pinBoundaryIndex(withoutTab, pinnedSetAfter);
      const nextTabs = [...withoutTab.slice(0, insertAt), tab, ...withoutTab.slice(insertAt)];
      savePinnedTabs(nextPinned);
      return {
        mainTabs: nextTabs,
        pinnedMainTabKeys: nextPinned,
      };
    }),
  reorderMainTabs: (activeKey, overKey) =>
    set((s) => {
      // Dashboard is anchored at index 0 — it's never a drag source
      // or drop target. The bar enforces this by rendering it
      // outside the SortableContext, but we double-guard here so
      // the store stays defensive against a stray programmatic
      // call.
      if (activeKey === DASHBOARD_TAB_KEY) return s;
      if (activeKey === overKey) return s;
      const fromIdx = s.mainTabs.findIndex((t) => mainTabKey(t) === activeKey);
      if (fromIdx < 0) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const activeIsPinned = isPinnedKey(activeKey, pinnedSet);
      // Refuse cross-zone drops. Pinning is an explicit gesture
      // (right-click → Pin, or click the pin badge) — silently
      // moving a tab across the boundary on drag would surprise
      // users who'd expect "drag to reorder" not "drag to repin".
      // Falling through to no-op leaves the dragged tab back where
      // it started, which dnd-kit handles gracefully.
      if (overKey != null) {
        if (overKey === DASHBOARD_TAB_KEY) return s;
        const overIsPinned = isPinnedKey(overKey, pinnedSet);
        if (activeIsPinned !== overIsPinned) return s;
      }
      const tab = s.mainTabs[fromIdx];
      if (!tab) return s;
      const withoutTab = [...s.mainTabs.slice(0, fromIdx), ...s.mainTabs.slice(fromIdx + 1)];
      let insertAt: number;
      if (overKey == null) {
        // No drop target → land at the end of the active tab's
        // zone. Pinned tabs end at `pinBoundaryIndex`; unpinned
        // tabs end at the array end.
        insertAt = activeIsPinned ? pinBoundaryIndex(withoutTab, pinnedSet) : withoutTab.length;
      } else {
        const overIdx = withoutTab.findIndex((t) => mainTabKey(t) === overKey);
        if (overIdx < 0) return s;
        insertAt = overIdx;
      }
      const nextTabs = [...withoutTab.slice(0, insertAt), tab, ...withoutTab.slice(insertAt)];
      // Identity short-circuit: if the resulting array equals the
      // source, skip the set() so subscribers / SortableContext
      // animations don't restart for a no-op drop.
      let identical = nextTabs.length === s.mainTabs.length;
      if (identical) {
        for (let i = 0; i < nextTabs.length; i++) {
          if (mainTabKey(nextTabs[i]!) !== mainTabKey(s.mainTabs[i]!)) {
            identical = false;
            break;
          }
        }
      }
      if (identical) return s;
      return { mainTabs: nextTabs };
    }),
  moveMainTabLeft: (key) =>
    set((s) => {
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx <= 0) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const isPinned = isPinnedKey(key, pinnedSet);
      const prev = s.mainTabs[idx - 1];
      if (!prev) return s;
      const prevKey = mainTabKey(prev);
      // Dashboard at idx 0 falls under this guard automatically:
      // it's not in the pinned set, and any non-dashboard tab that
      // would swap with it is necessarily either pinned or
      // unpinned, so the zone check fails and we no-op.
      if (prevKey === DASHBOARD_TAB_KEY) return s;
      const prevIsPinned = isPinnedKey(prevKey, pinnedSet);
      // Don't let "move left" pop a tab across a zone boundary —
      // that would silently flip pin state, which the user can do
      // explicitly via the Pin/Unpin entry.
      if (prevIsPinned !== isPinned) return s;
      const nextTabs = [...s.mainTabs];
      nextTabs[idx - 1] = nextTabs[idx]!;
      nextTabs[idx] = prev;
      return { mainTabs: nextTabs };
    }),
  moveMainTabRight: (key) =>
    set((s) => {
      if (key === DASHBOARD_TAB_KEY) return s;
      const idx = s.mainTabs.findIndex((t) => mainTabKey(t) === key);
      if (idx < 0 || idx >= s.mainTabs.length - 1) return s;
      const pinnedSet = new Set(s.pinnedMainTabKeys);
      const isPinned = isPinnedKey(key, pinnedSet);
      const next = s.mainTabs[idx + 1];
      if (!next) return s;
      const nextKey = mainTabKey(next);
      const nextIsPinned = isPinnedKey(nextKey, pinnedSet);
      // Same zone-boundary guard as `moveMainTabLeft`.
      if (nextIsPinned !== isPinned) return s;
      const nextTabs = [...s.mainTabs];
      nextTabs[idx + 1] = nextTabs[idx]!;
      nextTabs[idx] = next;
      return { mainTabs: nextTabs };
    }),
});
