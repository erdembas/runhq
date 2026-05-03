import { useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';

export function useProjectOverviewPolling() {
  useEffect(() => {
    const store = useAppStore.getState();
    let alive = true;

    void (async () => {
      try {
        const rows = await ipc.listPersistedScans();
        if (alive) useAppStore.getState().hydratePersistedScans(rows);
      } catch (err) {
        console.error('list_persisted_scans failed', err);
      }
    })();

    const poll = async () => {
      try {
        store.setOverviewLoading(true);
        const data = await ipc.getProjectOverview(30);
        if (alive) store.setOverview(data);
      } catch (err) {
        console.error('get_project_overview failed', err);
      } finally {
        if (alive) store.setOverviewLoading(false);
      }
    };

    void poll();
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
}
