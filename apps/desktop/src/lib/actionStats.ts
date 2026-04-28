/**
 * Per-service action usage tracker.
 *
 * Surfaces a project's most-used quick-action commands at the top of the
 * QuickAction palette so muscle-memory work (the editor you always open,
 * the script you always run) gets a 0-keystroke target instead of a
 * 4-keystroke scroll.
 *
 * Storage: a single localStorage entry, JSON-encoded. Stays in the
 * QuickAction window's origin — different from per-machine prefs in the
 * Rust state — because this is purely local UX preference, not anything
 * the user would expect to sync to another machine. If it gets evicted
 * (private mode, quota), tracking silently no-ops.
 *
 * Key scheme is the caller's contract; we never invent keys here. See
 * `apps/desktop/src/components/quick-action/items.tsx` for the canonical
 * list (`start-stop-all`, `open-editor:<key>`, `cmd:<name>`, etc.).
 */

const STORAGE_KEY = 'runhq.actionStats';
const VERSION = 1;

interface ActionStat {
  /** Total number of times this action ran on this service. */
  c: number;
  /** ms-since-epoch of the last run. Used as a recency tiebreaker. */
  t: number;
}

interface ServiceStats {
  [actionKey: string]: ActionStat;
}

interface Store {
  v: number;
  data: { [serviceId: string]: ServiceStats };
}

function emptyStore(): Store {
  return { v: VERSION, data: {} };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store> | null;
    // Be paranoid about shape — older versions or hand-edited values
    // shouldn't crash the palette. Treat anything off-schema as empty.
    if (
      !parsed ||
      parsed.v !== VERSION ||
      typeof parsed.data !== 'object' ||
      parsed.data === null
    ) {
      return emptyStore();
    }
    return parsed as Store;
  } catch {
    return emptyStore();
  }
}

function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full / disabled — non-critical, ranking just won't persist.
  }
}

/**
 * Record one successful run of `actionKey` for `serviceId`. Call AFTER
 * the action completes so failures don't promote dead actions to Recent.
 */
export function recordActionUse(serviceId: string, actionKey: string): void {
  if (!serviceId || !actionKey) return;
  const store = loadStore();
  const svc = (store.data[serviceId] ??= {});
  const stat = (svc[actionKey] ??= { c: 0, t: 0 });
  stat.c += 1;
  stat.t = Date.now();
  saveStore(store);
}

export interface TopActionsOptions {
  /** Max keys returned. Default 3. */
  n?: number;
  /**
   * Hide actions that haven't been used at least this many times.
   * Default 2 — one accidental click shouldn't reorder the palette.
   */
  minCount?: number;
}

/**
 * Top N most-used action keys for `serviceId`, sorted count DESC with
 * lastUsedTs DESC as tiebreaker. Returns `[]` for unknown services.
 */
export function topActionKeys(serviceId: string, opts: TopActionsOptions = {}): string[] {
  const { n = 3, minCount = 2 } = opts;
  if (!serviceId) return [];
  const store = loadStore();
  const svc = store.data[serviceId];
  if (!svc) return [];
  return Object.entries(svc)
    .filter(([, stat]) => stat.c >= minCount)
    .sort((a, b) => {
      if (b[1].c !== a[1].c) return b[1].c - a[1].c;
      return b[1].t - a[1].t;
    })
    .slice(0, n)
    .map(([key]) => key);
}

/**
 * Wipe stats. With no `serviceId`, drops the entire store; with one,
 * drops just that service's entries. Intended for an eventual settings
 * "Reset Recent Actions" button — not wired into UI yet.
 */
export function clearActionStats(serviceId?: string): void {
  if (!serviceId) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }
  const store = loadStore();
  if (store.data[serviceId]) {
    delete store.data[serviceId];
    saveStore(store);
  }
}
