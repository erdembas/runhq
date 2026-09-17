import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { ipc } from '@/lib/ipc';
import { agentCatalogKey, createAgentCatalogCache } from './agentCatalogCache';

// Coalesce requests across global/project views. Cache successful discovery for five minutes.
const catalogs = createAgentCatalogCache();
export function useAgentCatalog(
  backend: string,
  executable: string,
  projectId: string,
  enabled = true,
  sessionId?: string,
  model?: string,
) {
  const tool = useAgentStore((s) => s.tools.find((t) => t.id === backend));
  const checkedAt = useAgentStore((s) => s.toolsCheckedAt);
  const key = agentCatalogKey(backend, executable, projectId, sessionId, model, tool);
  const canDiscover =
    enabled &&
    !!backend &&
    !!projectId &&
    tool?.enabled !== false &&
    (!!executable.trim() || !!tool?.available);
  const subscribe = useCallback((listener: () => void) => catalogs.subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => catalogs.getSnapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    // Retry once after a new tool scan, selection or visible connection. A failure snapshot
    // alone never re-runs this effect, so a failed CLI cannot start an automatic retry loop.
    if (canDiscover && catalogs.getSnapshot(key).status === 'error') catalogs.invalidate(key);
  }, [key, canDiscover, checkedAt]);
  useEffect(() => {
    if (!canDiscover || snapshot.status !== 'idle') return;
    // Avoid launching a CLI for every keystroke in an executable override.
    const timer = window.setTimeout(() => {
      void catalogs
        .load(key, () => ipc.agentCatalog(backend, executable.trim(), projectId, sessionId, model))
        .catch(() => {
          /* The shared snapshot exposes the error to every consumer. */
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [backend, executable, projectId, key, canDiscover, sessionId, model, snapshot.status]);
  const refresh = useCallback(() => {
    catalogs.invalidate(key);
  }, [key]);
  return {
    catalog: snapshot.catalog,
    error: snapshot.error,
    loading: canDiscover && (snapshot.status === 'idle' || snapshot.status === 'loading'),
    refresh,
  };
}
