import { create } from 'zustand';
import type {
  DetectedEditor,
  GitStatus,
  ListeningPort,
  LogLine,
  ResourceSample,
  Section,
  SectionColor,
  SectionId,
  ServiceDef,
  ServiceId,
  ServiceStatus,
  StackDef,
} from '@/types';
import { nextSectionColor } from '@/lib/sectionColors';

interface LogBuffer {
  lines: LogLine[];
  lastSeq: number;
}

export type SidebarGroupBy = 'none' | 'category' | 'runtime' | 'status';
export type DashboardGroupBy = 'none' | 'category' | 'runtime' | 'status';
export type SidebarStatusFilter = 'all' | 'running' | 'stopped';

interface AppStore {
  services: ServiceDef[];
  statuses: Record<ServiceId, ServiceStatus>;
  logs: Record<string, LogBuffer>;
  ports: ListeningPort[];
  editors: DetectedEditor[];
  /**
   * Per-service git snapshot. `null` means "checked, not a repo"; `undefined`
   * means "not yet loaded" so the UI can show a loading shimmer before the
   * first poll returns.
   */
  git: Record<ServiceId, GitStatus | null>;
  /** Most recent CPU + memory sample per running service (2s cadence from Rust). */
  resources: Record<ServiceId, ResourceSample>;
  /** Rolling CPU% history per service for sparklines — bounded to [`RESOURCE_HISTORY_MAX`]. */
  resourceHistory: Record<ServiceId, number[]>;
  selectedServiceId: ServiceId | null;
  selectedCmdName: string | null;
  selectedStackId: string | null;
  appVersion: string | null;
  stateDir: string | null;

  // UI state.
  categoryFilter: string[];
  runtimeFilter: string[];
  /**
   * Sidebar-only status filter. Lets the user hide stopped services without
   * committing to a category/runtime pill — the most common "just show me
   * what's running" slice.
   */
  sidebarStatusFilter: SidebarStatusFilter;
  /**
   * How the sidebar service list is grouped. Defaults to a flat alphabetical
   * list because category grouping added visual noise for typical repos
   * (< 20 services); users can still switch to category/runtime/status
   * grouping from the filter menu when lists grow.
   */
  sidebarGroupBy: SidebarGroupBy;
  dashboardGroupBy: DashboardGroupBy;
  search: string;
  editorService: ServiceDef | null | undefined;
  stacks: StackDef[];
  editorStack: StackDef | null | undefined;

  /**
   * Sidebar-only organisational groups. Sections are a pure UI concept —
   * they carry no runtime semantics and are never sent to the backend. A
   * service or stack may belong to at most one section; unassigned items
   * fall through to the "Unassigned" pseudo-section at the bottom.
   */
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;

  setServices: (services: ServiceDef[]) => void;
  upsertService: (svc: ServiceDef) => void;
  removeService: (id: ServiceId) => void;
  setStatus: (status: ServiceStatus) => void;
  appendLog: (key: string, line: LogLine) => void;
  replaceLogs: (key: string, lines: LogLine[]) => void;
  clearLogs: (key: string) => void;
  setPorts: (ports: ListeningPort[]) => void;
  setEditors: (editors: DetectedEditor[]) => void;
  setGit: (id: ServiceId, status: GitStatus | null) => void;
  setResources: (id: ServiceId, sample: ResourceSample) => void;
  setSelected: (id: ServiceId | null) => void;
  setSelectedCmd: (cmdName: string | null) => void;
  setSelectedStack: (id: string | null) => void;
  setAppMeta: (version: string, stateDir: string) => void;

  setCategoryFilter: (keys: string[]) => void;
  setRuntimeFilter: (keys: string[]) => void;
  setSidebarStatusFilter: (v: SidebarStatusFilter) => void;
  setSidebarGroupBy: (v: SidebarGroupBy) => void;
  setDashboardGroupBy: (v: DashboardGroupBy) => void;
  resetSidebarFilters: () => void;
  setSearch: (q: string) => void;
  openEditor: (service: ServiceDef | null) => void;
  closeEditor: () => void;
  setStacks: (stacks: StackDef[]) => void;
  upsertStack: (stack: StackDef) => void;
  removeStack: (id: string) => void;
  openStackEditor: (stack: StackDef | null) => void;
  closeStackEditor: () => void;

  addSection: (name: string, color?: SectionColor) => SectionId;
  renameSection: (id: SectionId, name: string) => void;
  recolorSection: (id: SectionId, color: SectionColor) => void;
  deleteSection: (id: SectionId) => void;
  reorderSections: (ids: SectionId[]) => void;
  toggleSectionCollapsed: (id: SectionId) => void;
  /** Assign a service to a section, or pass `null` to move it to Unassigned. */
  assignServiceToSection: (serviceId: ServiceId, sectionId: SectionId | null) => void;
  assignStackToSection: (stackId: string, sectionId: SectionId | null) => void;
}

const MAX_UI_LOG_LINES = 5_000;

/** Sparkline window size. 60 samples at 2s = 2 minutes of history — long
 *  enough to catch a start-up CPU burst fading into steady state without
 *  bloating the store for idle services. */
const RESOURCE_HISTORY_MAX = 60;

export function logKey(serviceId: string, cmdName: string): string {
  return `${serviceId}::${cmdName}`;
}

const SIDEBAR_PREFS_KEY = 'runhq.sidebar.prefs.v1';
const DASHBOARD_PREFS_KEY = 'runhq.dashboard.prefs.v1';

interface SidebarPrefs {
  statusFilter: SidebarStatusFilter;
  groupBy: SidebarGroupBy;
  categoryFilter: string[];
  runtimeFilter: string[];
}

function loadSidebarPrefs(): SidebarPrefs {
  if (typeof window === 'undefined') {
    return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
  }
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw)
      return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    return {
      statusFilter:
        parsed.statusFilter === 'running' || parsed.statusFilter === 'stopped'
          ? parsed.statusFilter
          : 'all',
      groupBy:
        parsed.groupBy === 'category' || parsed.groupBy === 'runtime' || parsed.groupBy === 'status'
          ? parsed.groupBy
          : 'none',
      categoryFilter: Array.isArray(parsed.categoryFilter) ? parsed.categoryFilter : [],
      runtimeFilter: Array.isArray(parsed.runtimeFilter) ? parsed.runtimeFilter : [],
    };
  } catch {
    return { statusFilter: 'all', groupBy: 'none', categoryFilter: [], runtimeFilter: [] };
  }
}

function saveSidebarPrefs(prefs: SidebarPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota/private-mode failures are non-fatal; user state simply resets on
    // next launch.
  }
}

const initialSidebarPrefs = loadSidebarPrefs();

interface DashboardPrefs {
  groupBy: DashboardGroupBy;
}

function loadDashboardPrefs(): DashboardPrefs {
  if (typeof window === 'undefined') return { groupBy: 'category' };
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (!raw) return { groupBy: 'category' };
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      groupBy:
        parsed.groupBy === 'none' ||
        parsed.groupBy === 'category' ||
        parsed.groupBy === 'runtime' ||
        parsed.groupBy === 'status'
          ? parsed.groupBy
          : 'category',
    };
  } catch {
    return { groupBy: 'category' };
  }
}

function saveDashboardPrefs(prefs: DashboardPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota or private-mode failure — non-fatal
  }
}

const initialDashboardPrefs = loadDashboardPrefs();

const SECTIONS_KEY = 'runhq.sections.v1';

interface SectionsSnapshot {
  sections: Section[];
  serviceSection: Record<ServiceId, SectionId>;
  stackSection: Record<string, SectionId>;
  collapsedSections: Record<SectionId, boolean>;
}

function emptySections(): SectionsSnapshot {
  return { sections: [], serviceSection: {}, stackSection: {}, collapsedSections: {} };
}

function loadSections(): SectionsSnapshot {
  if (typeof window === 'undefined') return emptySections();
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    if (!raw) return emptySections();
    const parsed = JSON.parse(raw) as Partial<SectionsSnapshot>;
    // Defensive: strip malformed entries rather than crashing the sidebar on
    // a corrupted prefs file.
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s): s is Section =>
            !!s &&
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            typeof s.color === 'string',
        )
      : [];
    return {
      sections,
      serviceSection:
        parsed.serviceSection && typeof parsed.serviceSection === 'object'
          ? (parsed.serviceSection as Record<ServiceId, SectionId>)
          : {},
      stackSection:
        parsed.stackSection && typeof parsed.stackSection === 'object'
          ? (parsed.stackSection as Record<string, SectionId>)
          : {},
      collapsedSections:
        parsed.collapsedSections && typeof parsed.collapsedSections === 'object'
          ? (parsed.collapsedSections as Record<SectionId, boolean>)
          : {},
    };
  } catch {
    return emptySections();
  }
}

function saveSections(snapshot: SectionsSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(snapshot));
  } catch {
    // Same non-fatal policy as sidebar prefs.
  }
}

const initialSections = loadSections();

function genSectionId(): SectionId {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return `sec_${g.crypto.randomUUID()}`;
  }
  return `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const useAppStore = create<AppStore>((set, get) => ({
  services: [],
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

  categoryFilter: initialSidebarPrefs.categoryFilter,
  runtimeFilter: initialSidebarPrefs.runtimeFilter,
  sidebarStatusFilter: initialSidebarPrefs.statusFilter,
  sidebarGroupBy: initialSidebarPrefs.groupBy,
  dashboardGroupBy: initialDashboardPrefs.groupBy,
  search: '',
  editorService: undefined,
  stacks: [],
  editorStack: undefined,

  sections: initialSections.sections,
  serviceSection: initialSections.serviceSection,
  stackSection: initialSections.stackSection,
  collapsedSections: initialSections.collapsedSections,

  setServices: (services) => set({ services }),

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
      saveSections({
        sections: s.sections,
        serviceSection: restServiceSection,
        stackSection: s.stackSection,
        collapsedSections: s.collapsedSections,
      });
      return {
        services: s.services.filter((x) => x.id !== id),
        selectedServiceId: s.selectedServiceId === id ? null : s.selectedServiceId,
        serviceSection: restServiceSection,
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
  setSelected: (id) => set({ selectedServiceId: id, selectedCmdName: null, selectedStackId: null }),
  setSelectedCmd: (cmdName) => set({ selectedCmdName: cmdName }),
  setSelectedStack: (id) =>
    set({ selectedStackId: id, selectedServiceId: null, selectedCmdName: null }),
  setAppMeta: (version, stateDir) => set({ appVersion: version, stateDir }),

  setCategoryFilter: (keys) => {
    set({ categoryFilter: keys });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: s.sidebarGroupBy,
      categoryFilter: keys,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setRuntimeFilter: (keys) => {
    set({ runtimeFilter: keys });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: s.sidebarGroupBy,
      categoryFilter: s.categoryFilter,
      runtimeFilter: keys,
    });
  },
  setSidebarStatusFilter: (v) => {
    set({ sidebarStatusFilter: v });
    const s = get();
    saveSidebarPrefs({
      statusFilter: v,
      groupBy: s.sidebarGroupBy,
      categoryFilter: s.categoryFilter,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setSidebarGroupBy: (v) => {
    set({ sidebarGroupBy: v });
    const s = get();
    saveSidebarPrefs({
      statusFilter: s.sidebarStatusFilter,
      groupBy: v,
      categoryFilter: s.categoryFilter,
      runtimeFilter: s.runtimeFilter,
    });
  },
  setDashboardGroupBy: (v) => {
    set({ dashboardGroupBy: v });
    saveDashboardPrefs({ groupBy: v });
  },
  resetSidebarFilters: () => {
    set({
      sidebarStatusFilter: 'all',
      sidebarGroupBy: 'none',
      categoryFilter: [],
      runtimeFilter: [],
    });
    saveSidebarPrefs({
      statusFilter: 'all',
      groupBy: 'none',
      categoryFilter: [],
      runtimeFilter: [],
    });
  },
  setSearch: (q) => set({ search: q }),
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
      saveSections({
        sections: s.sections,
        serviceSection: s.serviceSection,
        stackSection: restStackSection,
        collapsedSections: s.collapsedSections,
      });
      return {
        stacks: s.stacks.filter((x) => x.id !== id),
        stackSection: restStackSection,
      };
    }),
  openStackEditor: (stack) => set({ editorStack: stack }),
  closeStackEditor: () => set({ editorStack: undefined }),

  addSection: (name, color) => {
    const id = genSectionId();
    const trimmed = name.trim() || 'New section';
    const s = get();
    const chosen = color ?? nextSectionColor(s.sections.map((x) => x.color));
    const nextSections: Section[] = [...s.sections, { id, name: trimmed, color: chosen }];
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
    });
    return id;
  },
  renameSection: (id, name) => {
    const s = get();
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, name: trimmed } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
    });
  },
  recolorSection: (id, color) => {
    const s = get();
    const nextSections = s.sections.map((sec) => (sec.id === id ? { ...sec, color } : sec));
    set({ sections: nextSections });
    saveSections({
      sections: nextSections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
    });
  },
  deleteSection: (id) => {
    const s = get();
    const nextSections = s.sections.filter((sec) => sec.id !== id);
    // Any item still pointing at this section gets moved to Unassigned.
    const nextServiceSection: Record<ServiceId, SectionId> = {};
    for (const [k, v] of Object.entries(s.serviceSection)) {
      if (v !== id) nextServiceSection[k] = v;
    }
    const nextStackSection: Record<string, SectionId> = {};
    for (const [k, v] of Object.entries(s.stackSection)) {
      if (v !== id) nextStackSection[k] = v;
    }
    const { [id]: _c, ...nextCollapsed } = s.collapsedSections;
    void _c;
    set({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
    });
    saveSections({
      sections: nextSections,
      serviceSection: nextServiceSection,
      stackSection: nextStackSection,
      collapsedSections: nextCollapsed,
    });
  },
  reorderSections: (ids) => {
    const s = get();
    const byId = new Map(s.sections.map((sec) => [sec.id, sec]));
    const ordered: Section[] = [];
    for (const id of ids) {
      const sec = byId.get(id);
      if (sec) {
        ordered.push(sec);
        byId.delete(id);
      }
    }
    // Any sections missing from `ids` are appended to preserve them.
    for (const sec of byId.values()) ordered.push(sec);
    set({ sections: ordered });
    saveSections({
      sections: ordered,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
    });
  },
  toggleSectionCollapsed: (id) => {
    const s = get();
    const nextCollapsed = {
      ...s.collapsedSections,
      [id]: !s.collapsedSections[id],
    };
    set({ collapsedSections: nextCollapsed });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: s.stackSection,
      collapsedSections: nextCollapsed,
    });
  },
  assignServiceToSection: (serviceId, sectionId) => {
    const s = get();
    const next = { ...s.serviceSection };
    if (sectionId == null) {
      delete next[serviceId];
    } else {
      next[serviceId] = sectionId;
    }
    set({ serviceSection: next });
    saveSections({
      sections: s.sections,
      serviceSection: next,
      stackSection: s.stackSection,
      collapsedSections: s.collapsedSections,
    });
  },
  assignStackToSection: (stackId, sectionId) => {
    const s = get();
    const next = { ...s.stackSection };
    if (sectionId == null) {
      delete next[stackId];
    } else {
      next[stackId] = sectionId;
    }
    set({ stackSection: next });
    saveSections({
      sections: s.sections,
      serviceSection: s.serviceSection,
      stackSection: next,
      collapsedSections: s.collapsedSections,
    });
  },
}));
