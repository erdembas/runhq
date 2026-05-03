import { create } from 'zustand';
import type { AppStore } from '@/store/appStoreTypes';
import { DASHBOARD_TAB_KEY, mainTabKey } from '@/store/appStoreTypes';

export type {
  AiActionHook,
  AiDraft,
  AppStore,
  DashboardGroupBy,
  DashboardSortBy,
  MainTab,
  MainTabKind,
  OpenAiChatInput,
  SettingsCategoryId,
  SidebarGroupBy,
  SidebarStatusFilter,
} from '@/store/appStoreTypes';
export {
  DASHBOARD_TAB,
  DASHBOARD_TAB_KEY,
  RELEASE_NOTES_TAB,
  RELEASE_NOTES_TAB_KEY,
  SETTINGS_TAB,
  SETTINGS_TAB_KEY,
  mainTabKey,
} from '@/store/appStoreTypes';
import {
  MAX_UI_LOG_LINES,
  RESOURCE_HISTORY_MAX,
  dropItemKey,
  itemOrderKey,
  savePinnedTabs,
  saveSections,
} from '@/store/appStoreRuntime';
import { createAiChatSlice } from '@/store/slices/aiChatSlice';
import { createFilterSlice } from '@/store/slices/filterSlice';
import { createMainTabSlice } from '@/store/slices/mainTabSlice';
import { createOverviewSlice } from '@/store/slices/overviewSlice';
import { createSectionsSlice } from '@/store/slices/sectionsSlice';
import { createUiSlice } from '@/store/slices/uiSlice';

export { MAX_OPEN_TABS, logKey } from '@/store/appStoreRuntime';

export const useAppStore = create<AppStore>()(
  (set, get, api) =>
    ({
      services: [],
      servicesLoaded: false,
      statuses: {},
      logs: {},
      ports: [],
      editors: [],
      git: {},
      resources: {},
      resourceHistory: {},
      selectedServiceId: null,
      selectedCmdName: null,
      selectedStackId: null,
      appVersion: null,
      stateDir: null,

      editorService: undefined,
      stacks: [],
      editorStack: undefined,

      // Flips `servicesLoaded` on first call. Mirrors the natural
      // "I just received the roster from Rust" semantic regardless of
      // whether the list is empty — once we've heard back, the skeleton
      // is dismissed and the dashboard switches to its real
      // empty-state / populated rendering.
      setServices: (services) => set({ services, servicesLoaded: true }),

      upsertService: (svc) =>
        set((s) => {
          const idx = s.services.findIndex((x) => x.id === svc.id);
          const next = [...s.services];
          if (idx >= 0) next[idx] = svc;
          else next.push(svc);
          return { services: next };
        }),

      removeService: (id) =>
        set((s) => {
          const { [id]: _omit, ...restServiceSection } = s.serviceSection;
          void _omit;
          const nextOrder = dropItemKey(s.sectionItemOrder, itemOrderKey('service', id));
          saveSections({
            sections: s.sections,
            serviceSection: restServiceSection,
            stackSection: s.stackSection,
            collapsedSections: s.collapsedSections,
            sectionItemOrder: nextOrder,
          });

          // If a tab for this service is open, drop it. If it was the
          // active tab, snap focus back to the dashboard so the user
          // doesn't end up on a phantom tab.
          const closedKey = mainTabKey({ kind: 'service', refId: id });
          const nextTabs = s.mainTabs.filter((t) => mainTabKey(t) !== closedKey);
          const tabsChanged = nextTabs.length !== s.mainTabs.length;
          const nextActive =
            tabsChanged && s.activeMainTabKey === closedKey
              ? DASHBOARD_TAB_KEY
              : s.activeMainTabKey;
          const becameDashboard = nextActive === DASHBOARD_TAB_KEY && tabsChanged;

          // Drop any lingering pin for the deleted service so it
          // doesn't haunt the persisted prefs forever (and so a future
          // service that happens to reuse this id — admittedly rare —
          // doesn't auto-pin itself unexpectedly).
          const pinnedHadKey = s.pinnedMainTabKeys.includes(closedKey);
          const nextPinned = pinnedHadKey
            ? s.pinnedMainTabKeys.filter((k) => k !== closedKey)
            : s.pinnedMainTabKeys;
          if (pinnedHadKey) savePinnedTabs(nextPinned);

          return {
            services: s.services.filter((x) => x.id !== id),
            selectedServiceId:
              s.selectedServiceId === id || becameDashboard ? null : s.selectedServiceId,
            selectedStackId: becameDashboard ? null : s.selectedStackId,
            serviceSection: restServiceSection,
            sectionItemOrder: nextOrder,
            mainTabs: tabsChanged ? nextTabs : s.mainTabs,
            activeMainTabKey: nextActive,
            pinnedMainTabKeys: nextPinned,
          };
        }),

      setStatus: (status) =>
        set((s) => ({
          statuses: { ...s.statuses, [status.id]: status },
        })),

      appendLog: (key, line) =>
        set((s) => {
          const current = s.logs[key] ?? { lines: [], lastSeq: 0 };
          if (line.seq <= current.lastSeq) return s;
          const nextLines =
            current.lines.length >= MAX_UI_LOG_LINES
              ? [...current.lines.slice(current.lines.length - MAX_UI_LOG_LINES + 1), line]
              : [...current.lines, line];
          return { logs: { ...s.logs, [key]: { lines: nextLines, lastSeq: line.seq } } };
        }),

      replaceLogs: (key, lines) =>
        set((s) => {
          const lastSeq = lines.length ? (lines[lines.length - 1]?.seq ?? 0) : 0;
          return { logs: { ...s.logs, [key]: { lines, lastSeq } } };
        }),

      clearLogs: (key) => set((s) => ({ logs: { ...s.logs, [key]: { lines: [], lastSeq: 0 } } })),

      setPorts: (ports) => set({ ports }),
      setEditors: (editors) => set({ editors }),
      setGit: (id, status) => set((s) => ({ git: { ...s.git, [id]: status } })),

      setResources: (id, sample) =>
        set((s) => {
          const prevHistory = s.resourceHistory[id] ?? [];
          const nextHistory =
            prevHistory.length >= RESOURCE_HISTORY_MAX
              ? [
                  ...prevHistory.slice(prevHistory.length - RESOURCE_HISTORY_MAX + 1),
                  sample.cpu_percent,
                ]
              : [...prevHistory, sample.cpu_percent];
          return {
            resources: { ...s.resources, [id]: sample },
            resourceHistory: { ...s.resourceHistory, [id]: nextHistory },
          };
        }),
      // setSelected(id) doubles as a tab-router: passing a service id
      // either activates the existing tab for that service, or opens a
      // new one. Passing `null` snaps back to the dashboard tab.
      //
      // Settings / Release Notes are first-class tabs now (see
      // `SETTINGS_TAB` / `RELEASE_NOTES_TAB` definitions), so nothing
      // here clears `releaseNotesOpen` / `settingsCategory` — those
      // tabs are allowed to stay in the strip while the user navigates
      // around. Closing them is an explicit gesture (X / Cmd+W).
      ...createMainTabSlice(set, get, api),
      setAppMeta: (version, stateDir) => set({ appVersion: version, stateDir }),

      ...createFilterSlice(set, get, api),
      openEditor: (service) => set({ editorService: service }),
      closeEditor: () => set({ editorService: undefined }),
      setStacks: (stacks) => set({ stacks }),
      upsertStack: (stack) =>
        set((s) => {
          const idx = s.stacks.findIndex((x) => x.id === stack.id);
          const next = [...s.stacks];
          if (idx >= 0) next[idx] = stack;
          else next.push(stack);
          return { stacks: next };
        }),
      removeStack: (id) =>
        set((s) => {
          const { [id]: _omit, ...restStackSection } = s.stackSection;
          void _omit;
          const nextOrder = dropItemKey(s.sectionItemOrder, itemOrderKey('stack', id));
          saveSections({
            sections: s.sections,
            serviceSection: s.serviceSection,
            stackSection: restStackSection,
            collapsedSections: s.collapsedSections,
            sectionItemOrder: nextOrder,
          });

          const closedKey = mainTabKey({ kind: 'stack', refId: id });
          const nextTabs = s.mainTabs.filter((t) => mainTabKey(t) !== closedKey);
          const tabsChanged = nextTabs.length !== s.mainTabs.length;
          const nextActive =
            tabsChanged && s.activeMainTabKey === closedKey
              ? DASHBOARD_TAB_KEY
              : s.activeMainTabKey;
          const becameDashboard = nextActive === DASHBOARD_TAB_KEY && tabsChanged;

          const pinnedHadKey = s.pinnedMainTabKeys.includes(closedKey);
          const nextPinned = pinnedHadKey
            ? s.pinnedMainTabKeys.filter((k) => k !== closedKey)
            : s.pinnedMainTabKeys;
          if (pinnedHadKey) savePinnedTabs(nextPinned);

          return {
            stacks: s.stacks.filter((x) => x.id !== id),
            stackSection: restStackSection,
            sectionItemOrder: nextOrder,
            mainTabs: tabsChanged ? nextTabs : s.mainTabs,
            activeMainTabKey: nextActive,
            selectedServiceId: becameDashboard ? null : s.selectedServiceId,
            selectedStackId: s.selectedStackId === id || becameDashboard ? null : s.selectedStackId,
            pinnedMainTabKeys: nextPinned,
          };
        }),
      openStackEditor: (stack) => set({ editorStack: stack }),
      closeStackEditor: () => set({ editorStack: undefined }),

      ...createAiChatSlice(set, get, api),
      ...createOverviewSlice(set, get, api),
      ...createSectionsSlice(set, get, api),
      ...createUiSlice(set, get, api),
    }) as AppStore,
);
