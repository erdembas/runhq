import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';

// Opening several project panes or returning from a CLI install/login should share one scan.
const RECHECK_AFTER_MS = 30_000;

export function useAgentDiscovery(visible = true) {
  const state = useVisibleStore(
    useAgentStore,
    useShallow((store) => ({
      loading: store.toolsLoading,
      ready: store.toolsReady,
      error: store.toolsError,
      checkedAt: store.toolsCheckedAt,
    })),
    visible,
  );
  const refresh = useCallback(async () => {
    try {
      await useAgentStore.getState().refreshTools();
    } catch {
      /* The store exposes the error. */
    }
  }, []);
  useEffect(() => {
    if (!visible) return;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const store = useAgentStore.getState();
      if (
        !store.toolsLoading &&
        (!store.toolsReady || Date.now() - store.toolsCheckedAt >= RECHECK_AFTER_MS)
      )
        void refresh();
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [visible, refresh]);
  return { ...state, refresh };
}
