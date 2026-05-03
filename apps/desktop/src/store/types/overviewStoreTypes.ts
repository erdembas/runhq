import type {
  DependencyScanEntry,
  DependencyScanResult,
  OverviewSummary,
  PersistedScan,
  ServiceId,
} from '@/types';

export interface OverviewStoreSlice {
  overview: OverviewSummary | null;
  overviewLoading: boolean;
  overviewScanning: boolean;
  /** Global "most-recent scan in this workspace" timestamp. Drives the
   *  dashboard header's "Last scanned X ago" label. Set by both
   *  `patchOverviewScan` (after an explicit scan) and
   *  `hydratePersistedScans` (on cold start) so we don't flash a
   *  "never scanned" state on every launch. */
  lastScanAt: number | null;
  /**
   * Per-project scan freshness, keyed by `service_id`. Sourced from
   * the persistent `dependency_scans` SQLite table on mount and updated
   * after every explicit scan. Lets a service card render its OWN
   * "Last scanned 3h ago" chip without needing to inflate
   * `OverviewSummary` with another field — the dashboard's project
   * overview mirrors what the Rust core knows; this is a UI-only
   * companion store.
   */
  scanFreshnessByService: Map<ServiceId, number>;
  /** Mirror of how long each project's last scan ran (ms). Optional —
   *  `null` for cache-hit entries from the in-memory L1. The drawer
   *  uses it to show "took 14s last time" before a manual rescan. */
  scanDurationByService: Map<ServiceId, number | null>;
  /**
   * Scan delta cache: per-service `{ outdated, vulns }` deltas
   * relative to the row this scan replaced. Drives the "+3 since
   * last scan" badge on the dashboard's audit/outdated chips.
   * Cleared when a service's scan reaches "fresh enough that the
   * delta is no longer interesting" (>30 minutes — see
   * `scanDeltaTtlMs`) so it doesn't linger as stale UI noise.
   */
  scanDeltasByService: Map<ServiceId, { outdated: number | null; vulnerabilities: number | null }>;
  /** Per-service "rescanning" flag so a card-level spinner can sit
   *  next to the freshness chip without bouncing the global
   *  `overviewScanning` state when only one project is being
   *  rescanned. */
  scanningServiceIds: Set<ServiceId>;
  setOverview: (v: OverviewSummary | null) => void;
  setOverviewLoading: (v: boolean) => void;
  setOverviewScanning: (v: boolean) => void;
  patchOverviewScan: (result: DependencyScanResult) => void;
  /**
   * Splice a single per-project rescan result into the overview and
   * freshness maps. Same shape as `patchOverviewScan` but for one
   * service — used by the per-card "Rescan this" affordance and any
   * future auto-rescan flows.
   */
  patchScanEntry: (entry: DependencyScanEntry) => void;
  /**
   * Track that a per-project rescan is in flight for `serviceId`,
   * so the card can render a spinner without consulting the global
   * scanning flag. Mirror of `setOverviewScanning` but scoped.
   */
  setScanningService: (serviceId: ServiceId, scanning: boolean) => void;
  /**
   * Replay the persisted scan rows fetched from SQLite into the live
   * dashboard state. Called once on app mount before the first
   * background overview refresh — without it the dashboard would
   * flash empty audit chips for ~30s on every cold start, even
   * though we have last night's scan saved on disk. Re-running it
   * after an explicit scan is also safe; the merge is by
   * `service_id` and the most recent scan always wins.
   */
  hydratePersistedScans: (rows: PersistedScan[]) => void;
}
