import type {
  DashboardGroupBy,
  DashboardSortBy,
  SidebarGroupBy,
  SidebarStatusFilter,
} from '@/store/appStoreTypes';

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

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota/private-mode failures are non-fatal; user state simply resets on
    // next launch.
  }
}

export const initialSidebarPrefs = loadSidebarPrefs();

interface DashboardPrefs {
  groupBy: DashboardGroupBy;
  sortBy: DashboardSortBy;
  /** Default `false`: hidden services stay off the dashboard until the
   *  user explicitly toggles the "N hidden" chip. Persisted so the
   *  power-user "show me everything" mode survives reloads. */
  showHidden: boolean;
}

const VALID_GROUP_BYS: DashboardGroupBy[] = ['none', 'category', 'runtime', 'status'];
const VALID_SORT_BYS: DashboardSortBy[] = ['name', 'activity', 'risk', 'memory', 'cpu'];

function loadDashboardPrefs(): DashboardPrefs {
  const defaults: DashboardPrefs = { groupBy: 'category', sortBy: 'name', showHidden: false };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      groupBy: VALID_GROUP_BYS.includes(parsed.groupBy as DashboardGroupBy)
        ? (parsed.groupBy as DashboardGroupBy)
        : defaults.groupBy,
      sortBy: VALID_SORT_BYS.includes(parsed.sortBy as DashboardSortBy)
        ? (parsed.sortBy as DashboardSortBy)
        : defaults.sortBy,
      showHidden: typeof parsed.showHidden === 'boolean' ? parsed.showHidden : defaults.showHidden,
    };
  } catch {
    return defaults;
  }
}

export function saveDashboardPrefs(prefs: DashboardPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota or private-mode failure — non-fatal
  }
}

export const initialDashboardPrefs = loadDashboardPrefs();
