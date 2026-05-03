import {
  RELEASE_NOTES_TAB,
  RELEASE_NOTES_TAB_KEY,
  SETTINGS_TAB,
  SETTINGS_TAB_KEY,
  mainTabKey,
} from '@/store/appStoreTypes';
import {
  RIGHT_PANEL_MAX_W,
  RIGHT_PANEL_MIN_W,
  initialDiffShowUnchanged,
  insertTabRespectingPin,
  loadRightPanel,
  loadRightPanelWidth,
  loadSidebarPinned,
  saveDiffShowUnchanged,
  saveRightPanel,
  saveRightPanelWidth,
  saveSidebarPinned,
} from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createUiSlice: AppStoreSlice = (set, get) => ({
  timelineOpen: false,
  // `openTimeline` now drives the right-side shell — release notes /
  // What's New entries that used to spawn an overlay timeline now
  // simply activate the embedded "activity" panel. We keep
  // `timelineOpen` around as a legacy hook (some callers might still
  // listen to it), but the visible UI is wholly owned by `rightPanel`.
  openTimeline: () => set({ timelineOpen: true, rightPanel: 'activity' }),
  closeTimeline: () => set({ timelineOpen: false, rightPanel: null }),

  // VSCode-style right activity bar — see interface comment above.
  // Initial values are hydrated from localStorage at module load
  // (see helpers below). We persist on every mutation so the panel
  // state survives reloads.
  rightPanel: loadRightPanel(),
  rightPanelWidth: loadRightPanelWidth(),
  setRightPanel: (panel) => {
    saveRightPanel(panel);
    set({ rightPanel: panel });
  },
  toggleRightPanel: (panel) => {
    const current = get().rightPanel;
    const next = current === panel ? null : panel;
    saveRightPanel(next);
    set({ rightPanel: next });
  },
  setRightPanelWidth: (width) => {
    const clamped = Math.max(RIGHT_PANEL_MIN_W, Math.min(RIGHT_PANEL_MAX_W, width));
    saveRightPanelWidth(clamped);
    set({ rightPanelWidth: clamped });
  },

  sidebarPinned: loadSidebarPinned(),
  setSidebarPinned: (pinned) => {
    saveSidebarPinned(pinned);
    set({ sidebarPinned: pinned });
  },
  toggleSidebarPinned: () => {
    const next = !get().sidebarPinned;
    saveSidebarPinned(next);
    set({ sidebarPinned: next });
  },
  diffViewerOpen: false,
  diffViewerServiceId: null,
  diffViewerInitialTab: undefined,
  openDiffViewer: (serviceId, initialTab) =>
    set({
      diffViewerOpen: true,
      diffViewerServiceId: serviceId,
      diffViewerInitialTab: initialTab,
    }),
  closeDiffViewer: () =>
    set({
      diffViewerOpen: false,
      diffViewerServiceId: null,
      // Reset so the next open doesn't inherit the previous tab choice.
      diffViewerInitialTab: undefined,
    }),

  crossProjectDiffOpen: false,
  openCrossProjectDiff: () => set({ crossProjectDiffOpen: true }),
  closeCrossProjectDiff: () => set({ crossProjectDiffOpen: false }),

  whatsNewOpen: false,
  whatsNewVersion: null,
  openWhatsNew: (version) => set({ whatsNewOpen: true, whatsNewVersion: version }),
  closeWhatsNew: () => set({ whatsNewOpen: false }),

  releaseNotesOpen: false,
  releaseNotesSelectedVersion: null,
  // Release Notes is a singleton main tab now (see RELEASE_NOTES_TAB
  // definition above). Opening it adds the tab to the strip if it
  // isn't there, then activates it — the rest of the workspace
  // (services, dashboard, settings tab if any) stays mounted
  // alongside, so closing Release Notes returns the user to where
  // they were without a remount cycle. The `releaseNotesOpen` flag
  // shadows tab presence and is kept in sync by `closeMainTab`
  // (and the bulk-close reconcile helper).
  openReleaseNotes: (version) =>
    set((s) => {
      const exists = s.mainTabs.some((t) => mainTabKey(t) === RELEASE_NOTES_TAB_KEY);
      return {
        releaseNotesOpen: true,
        releaseNotesSelectedVersion: version ?? null,
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, RELEASE_NOTES_TAB, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: RELEASE_NOTES_TAB_KEY,
        // Mirror `setActiveMainTab` for the breadcrumb/sidebar:
        // jumping to Release Notes via status-bar / quick-action
        // shouldn't leave the sidebar still highlighting whatever
        // service/stack the user was on. Clicking the Release Notes
        // tab strip later goes through `setActiveMainTab` directly,
        // which performs the same clears — keeping the two entry
        // points symmetric.
        selectedServiceId: null,
        selectedStackId: null,
        selectedCmdName: null,
      };
    }),
  closeReleaseNotes: () => {
    // Delegated to closeMainTab so the snap-to-fallback logic and
    // the flag reconciliation live in exactly one place.
    get().closeMainTab(RELEASE_NOTES_TAB_KEY);
  },

  // ---- Settings hub ----------------------------------------------------------
  // Settings is a singleton main tab now (see SETTINGS_TAB definition
  // above). Opening it adds the tab + activates + records the
  // requested category; closing the tab through the X / Cmd+W /
  // closeSettings action all funnel through `closeMainTab`, which
  // also blanks `settingsCategory` so downstream consumers (the
  // prefs reload effect in App.tsx, the SettingsView body) see a
  // consistent "not open" state.
  settingsCategory: null,
  openSettings: (category) =>
    set((s) => {
      const exists = s.mainTabs.some((t) => mainTabKey(t) === SETTINGS_TAB_KEY);
      return {
        settingsCategory: category ?? 'shortcuts',
        mainTabs: exists
          ? s.mainTabs
          : insertTabRespectingPin(s.mainTabs, SETTINGS_TAB, new Set(s.pinnedMainTabKeys)),
        activeMainTabKey: SETTINGS_TAB_KEY,
        // Same breadcrumb-symmetry rationale as `openReleaseNotes`:
        // a status-bar Settings click jumps the active tab here,
        // so the sidebar shouldn't keep pointing at the previous
        // service/stack. Tab-strip activations route through
        // `setActiveMainTab` and already do the same clearing.
        selectedServiceId: null,
        selectedStackId: null,
        selectedCmdName: null,
      };
    }),
  closeSettings: () => {
    get().closeMainTab(SETTINGS_TAB_KEY);
  },

  diffShowUnchanged: initialDiffShowUnchanged,
  setDiffShowUnchanged: (v) => {
    set({ diffShowUnchanged: v });
    saveDiffShowUnchanged(v);
  },
});
