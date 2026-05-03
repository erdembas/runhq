import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DailySummary, TimelineEvent } from '@/types';
import { loadTimelineCollapsed, loadTimelineWidth } from './model';

interface ActivityTimelineState {
  events: TimelineEvent[];
  summary: DailySummary | null;
  weeklySummary: DailySummary[] | null;
  loading: boolean;
  filterType: string | null;
  filterProject: string | null;
  timeRange: string;
  search: string;
  selectedId: number | null;
  modalEventId: number | null;
  standupCopied: boolean;
  detailCopied: boolean;
  collapsed: boolean;
  hoverOpen: boolean;
  width: number;
  now: number;
}

type ActivityTimelinePatch =
  | Partial<ActivityTimelineState>
  | ((state: ActivityTimelineStore) => Partial<ActivityTimelineState>);

interface ActivityTimelineActions {
  patch: (patch: ActivityTimelinePatch) => void;
  clearFilters: () => void;
  setCollapsed: (collapsed: boolean) => void;
  markStandupCopied: () => void;
  markDetailCopied: () => void;
}

export type ActivityTimelineStore = ActivityTimelineState & ActivityTimelineActions;
export type ActivityTimelineStoreApi = StoreApi<ActivityTimelineStore>;

export function createActivityTimelineStore(): ActivityTimelineStoreApi {
  return createStore<ActivityTimelineStore>((set) => ({
    events: [],
    summary: null,
    weeklySummary: null,
    loading: true,
    filterType: null,
    filterProject: null,
    timeRange: '24h',
    search: '',
    selectedId: null,
    modalEventId: null,
    standupCopied: false,
    detailCopied: false,
    collapsed: loadTimelineCollapsed(),
    hoverOpen: false,
    width: loadTimelineWidth(),
    now: Date.now(),

    patch: (patch) => set((state) => (typeof patch === 'function' ? patch(state) : patch)),
    clearFilters: () =>
      set({ filterType: null, filterProject: null, timeRange: '24h', search: '' }),
    setCollapsed: (collapsed) => set(collapsed ? { collapsed } : { collapsed, hoverOpen: false }),
    markStandupCopied: () => {
      set({ standupCopied: true });
      window.setTimeout(() => set({ standupCopied: false }), 1800);
    },
    markDetailCopied: () => {
      set({ detailCopied: true });
      window.setTimeout(() => set({ detailCopied: false }), 1500);
    },
  }));
}

export function useActivityTimelineStoreRef(): ActivityTimelineStoreApi {
  const storeRef = useRef<ActivityTimelineStoreApi>();
  if (!storeRef.current) {
    storeRef.current = createActivityTimelineStore();
  }
  return storeRef.current;
}

export function useActivityTimelineStore<T>(
  store: ActivityTimelineStoreApi,
  selector: (state: ActivityTimelineStore) => T,
): T {
  return useStore(store, selector);
}
