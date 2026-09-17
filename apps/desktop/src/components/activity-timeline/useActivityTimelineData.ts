import { useCallback, useEffect, useRef } from 'react';
import { ipc, events as ipcEvents } from '@/lib/ipc';
import { getTimeSince, REFRESH_INTERVAL_MS, TIME_TICK_MS } from './model';
import {
  type ActivityTimelineStoreApi,
  useActivityTimelineStore,
} from './useActivityTimelineStore';

interface ActivityTimelineDataOptions {
  visible: boolean;
  isInline: boolean;
  collapsed: boolean;
  hoverOpen: boolean;
}

export function useActivityTimelineData(
  store: ActivityTimelineStoreApi,
  { visible, isInline, collapsed, hoverOpen }: ActivityTimelineDataOptions,
) {
  const filterProject = useActivityTimelineStore(store, (state) => state.filterProject);
  const filterType = useActivityTimelineStore(store, (state) => state.filterType);
  const timeRange = useActivityTimelineStore(store, (state) => state.timeRange);
  const patch = useActivityTimelineStore(store, (state) => state.patch);
  const panelVisible = visible && (!isInline || !collapsed || hoverOpen);
  const generation = useRef(0);
  const pending = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const today = new Date().toISOString().split('T')[0] ?? '';

  const refresh = useCallback(
    (opts: { showLoader?: boolean } = {}): Promise<void> => {
      if (!panelVisible) return Promise.resolve();
      const current = generation.current;
      if (pending.current?.generation === current) return pending.current.promise;
      const promise = (async () => {
        if (opts.showLoader !== false) patch({ loading: true });
        try {
          const sinceMs = getTimeSince(timeRange);
          const [events, summary, weeklySummary] = await Promise.all([
            ipc.getTimeline(filterProject, filterType, sinceMs, 500),
            ipc.getDailySummary(today),
            ipc.getWeeklySummary(today),
          ]);
          if (generation.current === current) patch({ events, summary, weeklySummary });
        } catch (err) {
          console.error('Failed to load timeline', err);
        } finally {
          if (generation.current === current) patch({ loading: false });
          if (pending.current?.generation === current) pending.current = null;
        }
      })();
      pending.current = { generation: current, promise };
      return promise;
    },
    [panelVisible, filterType, filterProject, patch, timeRange, today],
  );

  useEffect(() => {
    if (!panelVisible) return;
    const current = generation.current;
    void refresh();
    return () => {
      // A hidden panel or an old filter must not publish a late IPC response.
      generation.current = current + 1;
    };
  }, [panelVisible, refresh]);

  useEffect(() => {
    if (!panelVisible) return;
    const id = window.setInterval(() => {
      void refresh({ showLoader: false });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [panelVisible, refresh]);

  useEffect(() => {
    if (!panelVisible) return;
    patch({ now: Date.now() });
    const id = window.setInterval(() => patch({ now: Date.now() }), TIME_TICK_MS);
    return () => window.clearInterval(id);
  }, [panelVisible, patch]);

  useEffect(() => {
    if (!panelVisible) return;
    let disposed = false;
    let debounce: number | null = null;
    const trigger = () => {
      if (disposed || debounce !== null) return;
      debounce = window.setTimeout(() => {
        debounce = null;
        void refresh({ showLoader: false });
      }, 400);
    };
    const unsubs: Array<() => void> = [];
    const track = (unsubscribe: () => void) => {
      if (disposed) unsubscribe();
      else unsubs.push(unsubscribe);
    };
    void Promise.all([
      ipcEvents.onStatus(trigger).then(track),
      ipcEvents
        .onLog((event) => {
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
        })
        .then(track),
    ]).catch((err) => console.error('Failed to subscribe to timeline updates', err));
    return () => {
      disposed = true;
      if (debounce !== null) window.clearTimeout(debounce);
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [panelVisible, refresh]);

  return refresh;
}
