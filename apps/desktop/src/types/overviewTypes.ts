import type { GitStatus } from './serviceTypes';
import type { LicenseScanSummary } from './licenseTypes';

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  bump: string | null;
  homepage: string | null;
}

export interface OutdatedResult {
  total: number;
  major: number;
  minor: number;
  patch: number;
  packages: OutdatedPackage[];
}

export interface Advisory {
  id: string | null;
  package: string;
  severity: string;
  title: string;
  url: string | null;
  vulnerable_range: string | null;
  fix_version: string | null;
}

export interface AuditResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  advisories: Advisory[];
}

export interface ProjectOverview {
  service_id: string;
  name: string;
  cwd: string;
  runtime: string | null;
  is_running: boolean;
  git_status: GitStatus | null;
  cpu_percent: number;
  memory_bytes: number;
  last_activity: string | null;
  is_stale: boolean;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  /**
   * Slim license-scan summary collected by the workspace dependency
   * scan or hydrated from `dependency_scans.license_json` on cold
   * start. `null` while no scan has reached this project yet, while
   * the runtime has no license parser (Python / unknown), or while
   * the persisted row predates the license columns. The drawer's
   * `LicensePanel` continues to fetch the full `LicenseScanResult`
   * on demand — this summary only feeds the dashboard's chips,
   * filters, and worst-offenders surface.
   */
  license: LicenseScanSummary | null;
  tags: string[];
}

export interface OverviewSummary {
  projects: ProjectOverview[];
  total_running: number;
  total_stopped: number;
  total_dirty: number;
  total_behind: number;
  total_cpu: number;
  total_memory: number;
  total_outdated: number;
  total_vulnerabilities: number;
  /**
   * Workspace-wide contamination count: sum of strong + network +
   * proprietary licenses across every project's `LicenseScanSummary`.
   * Drives the hero's "N license risk" priority bucket.
   */
  total_license_warnings: number;
  /**
   * Number of projects with at least one contamination warning.
   * Used by the FilterBar chip count so it matches the roster size,
   * not the package size.
   */
  projects_with_license_risk: number;
  stale_count: number;
  has_dependency_scan: boolean;
}

export interface DependencyScanEntry {
  service_id: string;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  /**
   * Slim license summary captured alongside outdated/audit. `null`
   * when license scanning isn't supported for this runtime
   * (Python today, also Go's metadata-less mode), when the scan
   * timed out, or — for cache hits — when the in-memory entry
   * predates the license channel.
   */
  license: LicenseScanSummary | null;
  /**
   * Wall-clock epoch ms when this individual project's scan finished.
   * Used to drive the per-card "Last scanned 3h ago" chip.
   */
  scanned_at_ms: number;
  /** How long the per-project scan ran (ms). null on cache hits. */
  duration_ms: number | null;
  /**
   * `true` when the entry came out of the in-memory 5-minute cache
   * rather than a fresh subprocess run. Lets the UI tell "you just
   * rescanned" apart from "we reused a stale result".
   */
  from_cache: boolean;
  /**
   * Total outdated count from the previous persisted scan for this
   * project. `null` when there is no prior scan (first run) or this
   * entry came from cache (no meaningful comparison). Drives the
   * "↑3 since last scan" delta badge on the dashboard's outdated
   * chip — the difference between the live total and this number
   * tells the user "what changed since I last looked".
   */
  previous_total_outdated: number | null;
  previous_total_vulnerabilities: number | null;
  /**
   * Contamination count from the previous persisted scan. Same
   * semantics as the deps deltas — drives a "+1 contamination"
   * badge when a fresh scan introduces new strong/network/proprietary
   * licenses.
   */
  previous_total_license_warnings: number | null;
}

export interface DependencyScanResult {
  entries: DependencyScanEntry[];
  total_outdated: number;
  total_vulnerabilities: number;
  /** Workspace-wide contamination total. See `OverviewSummary.total_license_warnings`. */
  total_license_warnings: number;
  /** Workspace-wide strong-copyleft count (GPL family, excluding LGPL). */
  total_strong_copyleft: number;
  /** Workspace-wide network-copyleft count (AGPL / SSPL). */
  total_network_copyleft: number;
}

/**
 * One row from the persistent SQLite scan history. Returned by
 * `listPersistedScans()` so the dashboard can render a "Last scanned"
 * chip on every project card the moment it mounts, without having to
 * wait for a full rescan.
 *
 * Mirrors the Rust `PersistedScan` shape one-to-one. `cwd` and
 * `service_name` are denormalised at write time so we can label rows
 * even after a service has been removed and re-added (which would
 * orphan the row by `service_id`).
 */
export interface PersistedScan {
  service_id: string;
  cwd: string;
  service_name: string;
  outdated: OutdatedResult | null;
  audit: AuditResult | null;
  /**
   * License summary written by the workspace dependency scan.
   * `null` for rows from before the license columns were added
   * (additive migration leaves the column NULL on legacy rows) or
   * for runtimes the license scanner doesn't support.
   */
  license: LicenseScanSummary | null;
  scanned_at_ms: number;
  duration_ms: number | null;
  total_outdated: number;
  total_vulnerabilities: number;
  /** Denormalised contamination total (`strong + network + proprietary`). */
  total_license_warnings: number;
}
