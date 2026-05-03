import { useCallback, useEffect } from 'react';
import { ipc, events as ipcEvents } from '@/lib/ipc';
import { getTimeSince, REFRESH_INTERVAL_MS, TIME_TICK_MS } from './model';
import {
  type ActivityTimelineStoreApi,
  useActivityTimelineStore,
} from './useActivityTimelineStore';

interface ActivityTimelineDataOptions {
  isInline: boolean;
  collapsed: boolean;
  hoverOpen: boolean;
}

export function useActivityTimelineData(
  store: ActivityTimelineStoreApi,
  { isInline, collapsed, hoverOpen }: ActivityTimelineDataOptions,
) {
  const filterProject = useActivityTimelineStore(store, (state) => state.filterProject);
  const filterType = useActivityTimelineStore(store, (state) => state.filterType);
  const timeRange = useActivityTimelineStore(store, (state) => state.timeRange);
  const patch = useActivityTimelineStore(store, (state) => state.patch);

  const today = new Date().toISOString().split('T')[0] ?? '';

  const refresh = useCallback(
    async (opts: { showLoader?: boolean } = {}) => {
      if (opts.showLoader !== false) patch({ loading: true });
      try {
        const sinceMs = getTimeSince(timeRange);
        const [events, summary, weeklySummary] = await Promise.all([
          ipc.getTimeline(filterProject, filterType, sinceMs, 500),
          ipc.getDailySummary(today),
          ipc.getWeeklySummary(today),
        ]);
        patch({ events, summary, weeklySummary });
      } catch (err) {
        console.error('Failed to load timeline', err);
      } finally {
        patch({ loading: false });
      }
    },
    [filterType, filterProject, patch, timeRange, today],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const panelVisible = isInline ? !collapsed || hoverOpen : true;
    if (!panelVisible) return;
    const id = window.setInterval(() => {
      void refresh({ showLoader: false });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isInline, collapsed, hoverOpen, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => patch({ now: Date.now() }), TIME_TICK_MS);
    return () => window.clearInterval(id);
  }, [patch]);

  useEffect(() => {
    let debounce: number | null = null;
    const trigger = () => {
      if (debounce !== null) return;
      debounce = window.setTimeout(() => {
        debounce = null;
        void refresh({ showLoader: false });
      }, 400);
    };
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(await ipcEvents.onStatus(trigger));
      unsubs.push(
        await ipcEvents.onLog((event) => {
          if (event.line.stream !== 'stderr') return;
          const text = event.line.text.toLowerCase();
          if (
            text.includes('error') ||
            text.includes('warn') ||
            text.includes('fatal') ||
            text.includes('panic')
          ) {
            trigger();
          }
        }),
      );
    })();
    return () => {
      if (debounce !== null) window.clearTimeout(debounce);
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [refresh]);

  return refresh;
}
