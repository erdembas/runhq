// ---- License & Compliance Scanner -----------------------------------------

export type LicenseRisk =
  | 'safe'
  | 'permissive'
  | 'weak_copyleft'
  | 'strong_copyleft'
  | 'network_copyleft'
  | 'proprietary'
  | 'unknown';

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  risk: LicenseRisk;
  homepage: string | null;
  repository: string | null;
}

export interface ContaminationWarning {
  package: string;
  version: string;
  license: string;
  risk: LicenseRisk;
  message: string;
}

/**
 * Slim cross-project license-scan projection used by the dashboard's
 * `ProjectOverview`, `DependencyScanEntry`, and `PersistedScan`.
 * Carries the count breakdown plus the top 3 warnings — the full
 * `LicenseScanResult` (with every dependency's row) is fetched on
 * demand by the per-service `LicensePanel` drawer; shipping it
 * everywhere would balloon the IPC payload to megabytes per scan
 * for npm projects.
 */
export interface LicenseScanSummary {
  runtime: string | null;
  scan_supported: boolean;
  total_entries: number;
  permissive_count: number;
  safe_count: number;
  weak_copyleft_count: number;
  strong_copyleft_count: number;
  network_copyleft_count: number;
  proprietary_count: number;
  unknown_count: number;
  has_contamination: boolean;
  /**
   * First 3 contamination warnings (network → strong → proprietary
   * order). Drives the `LicenseChip` tooltip on the dashboard cards
   * and the AI "Why?" payload without having to round-trip the
   * full entry list.
   */
  top_warnings: ContaminationWarning[];
}

export interface LicenseScanResult {
  entries: LicenseEntry[];
  safe_count: number;
  permissive_count: number;
  weak_copyleft_count: number;
  strong_copyleft_count: number;
  network_copyleft_count: number;
  proprietary_count: number;
  unknown_count: number;
  has_contamination: boolean;
  contamination_warnings: ContaminationWarning[];
  /**
   * Detected runtime (`node`, `rust`, `go`, `python`, …) or `null`
   * when the project's runtime can't be identified. Drives the
   * runtime badge in the LicensePanel header.
   */
  runtime: string | null;
  /**
   * `true` only when RunHQ has a working license parser for this
   * runtime AND the underlying tool produced parseable output.
   * Frontend uses this to suppress the misleading "no contamination
   * detected" green banner on Python projects (no implementation),
   * Go projects (license metadata not exposed by `go list`), or
   * runs that timed out / errored.
   */
  scan_supported: boolean;
  /**
   * Human-readable explanation when `scan_supported` is `false`.
   * Rendered as a banner inside the License panel.
   */
  scan_message: string | null;
}
