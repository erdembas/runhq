import type { AgentBackend, AgentCatalog } from '@runhq/cockpit-types';

export function agentCatalogKey(
  backend: string,
  executable: string,
  projectId: string,
  sessionId: string | undefined,
  model: string | undefined,
  tool: AgentBackend | undefined,
  workingDirectory?: string,
): string {
  return JSON.stringify([
    backend,
    executable.trim(),
    projectId,
    sessionId,
    model,
    tool?.adapter,
    tool?.args,
    tool?.command,
    tool?.executable,
    tool?.version,
    tool?.available,
    tool?.enabled,
    tool?.detection_status,
    workingDirectory,
  ]);
}

export interface AgentCatalogSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly catalog: AgentCatalog | null;
  readonly error: string | null;
}

const EMPTY_SNAPSHOT: AgentCatalogSnapshot = { status: 'idle', catalog: null, error: null };
const LOADING_SNAPSHOT: AgentCatalogSnapshot = { status: 'loading', catalog: null, error: null };

/** All mounted consumers observe one result; pending work never expires mid-request. */
export function createAgentCatalogCache(ttl = 300_000, now = Date.now) {
  const entries = new Map<
    string,
    { promise: Promise<AgentCatalog>; expires: number; snapshot: AgentCatalogSnapshot }
  >();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => {
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
  };
  const getSnapshot = (key: string): AgentCatalogSnapshot => {
    const entry = entries.get(key);
    return entry && entry.expires > now() ? entry.snapshot : EMPTY_SNAPSHOT;
  };
  return {
    getSnapshot,
    subscribe(key: string, listener: () => void) {
      let subscribers = listeners.get(key);
      if (!subscribers) listeners.set(key, (subscribers = new Set()));
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(key);
      };
    },
    peek(key: string) {
      return getSnapshot(key).catalog ?? undefined;
    },
    hasPending(key: string) {
      return entries.get(key)?.snapshot.status === 'loading';
    },
    invalidate(key: string) {
      // A simultaneous refresh from another pane joins the same probe.
      if (entries.get(key)?.snapshot.status === 'loading') return;
      if (entries.delete(key)) notify(key);
    },
    load(key: string, loader: () => Promise<AgentCatalog>): Promise<AgentCatalog> {
      const cached = entries.get(key);
      if (cached && cached.snapshot.status !== 'error' && cached.expires > now())
        return cached.promise;
      for (const [id, entry] of entries) {
        // Evict only unused settled results. Evicting a mounted view would trigger another
        // probe and could make more than 64 mounted views continually reload one another.
        if (
          !listeners.has(id) &&
          entry.snapshot.status !== 'loading' &&
          (entry.expires <= now() || entries.size >= 64)
        )
          entries.delete(id);
      }
      const entry = {
        expires: Infinity,
        promise: Promise.resolve().then(loader),
        snapshot: LOADING_SNAPSHOT,
      };
      entries.set(key, entry);
      notify(key);
      void entry.promise.then(
        (value) => {
          entry.snapshot = { status: 'ready', catalog: value, error: null };
          entry.expires = now() + ttl;
          if (entries.get(key) === entry) notify(key);
        },
        (error) => {
          // Keep a stable failure snapshot: deleting it would cause the hook to see idle
          // and automatically retry forever. Explicit refresh or a new discovery retries.
          entry.snapshot = { status: 'error', catalog: null, error: String(error) };
          if (entries.get(key) === entry) notify(key);
        },
      );
      return entry.promise;
    },
  };
}
