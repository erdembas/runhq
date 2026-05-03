export type SidebarGroupBy = 'none' | 'category' | 'runtime' | 'status';
export type DashboardGroupBy = 'none' | 'category' | 'runtime' | 'status';
/**
 * Dashboard intra-group sort axis.
 *   • name      — alphabetical (default, stable)
 *   • activity  — most-recent commit first, never-touched last
 *   • risk      — CVE+outdated composite, worst first (zero-risk projects
 *                 keep their alphabetical order to avoid a weird reshuffle)
 *   • memory    — running projects by RSS desc, then non-running alphabetical
 *   • cpu       — running projects by CPU% desc, then non-running alphabetical
 */
export type DashboardSortBy = 'name' | 'activity' | 'risk' | 'memory' | 'cpu';
export type SidebarStatusFilter = 'all' | 'running' | 'stopped';

export interface FilterStoreSlice {
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
  dashboardSortBy: DashboardSortBy;
  /**
   * Whether the dashboard reveals services flagged
   * `hide_dashboard: true`. Off by default — those services exist
   * to be tracked in the sidebar / palette / search only, and
   * surfacing them on the dashboard would re-pollute the very
   * surface the flag was created to protect. The dashboard renders
   * a single "N hidden" toggle chip when at least one such service
   * exists, letting power users peek at the full roster without
   * editing each service back to visible.
   */
  dashboardShowHidden: boolean;
  search: string;

  setCategoryFilter: (keys: string[]) => void;
  setRuntimeFilter: (keys: string[]) => void;
  setSidebarStatusFilter: (v: SidebarStatusFilter) => void;
  setSidebarGroupBy: (v: SidebarGroupBy) => void;
  setDashboardGroupBy: (v: DashboardGroupBy) => void;
  setDashboardSortBy: (v: DashboardSortBy) => void;
  setDashboardShowHidden: (v: boolean) => void;
  resetSidebarFilters: () => void;
  setSearch: (q: string) => void;
}
