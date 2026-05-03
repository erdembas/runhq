import {
  initialDashboardPrefs,
  initialSidebarPrefs,
  saveDashboardPrefs,
  saveSidebarPrefs,
} from '@/store/appStoreRuntime';
import type { AppStoreSlice } from '@/store/slices/appStoreSlice';

export const createFilterSlice: AppStoreSlice = (set, get) => ({
  categoryFilter: initialSidebarPrefs.categoryFilter,
  runtimeFilter: initialSidebarPrefs.runtimeFilter,
  sidebarStatusFilter: initialSidebarPrefs.statusFilter,
  sidebarGroupBy: initialSidebarPrefs.groupBy,
  dashboardGroupBy: initialDashboardPrefs.groupBy,
  dashboardSortBy: initialDashboardPrefs.sortBy,
  dashboardShowHidden: initialDashboardPrefs.showHidden,
  search: '',
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
    saveDashboardPrefs({
      groupBy: v,
      sortBy: get().dashboardSortBy,
      showHidden: get().dashboardShowHidden,
    });
  },
  setDashboardSortBy: (v) => {
    set({ dashboardSortBy: v });
    saveDashboardPrefs({
      groupBy: get().dashboardGroupBy,
      sortBy: v,
      showHidden: get().dashboardShowHidden,
    });
  },
  setDashboardShowHidden: (v) => {
    set({ dashboardShowHidden: v });
    saveDashboardPrefs({
      groupBy: get().dashboardGroupBy,
      sortBy: get().dashboardSortBy,
      showHidden: v,
    });
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
});
