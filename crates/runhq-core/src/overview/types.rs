use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::git::GitStatus;
use crate::license::LicenseScanSummary;

// ---- Public data types ----------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ProjectOverview {
    pub service_id: String,
    pub name: String,
    pub cwd: String,
    pub runtime: Option<String>,
    pub is_running: bool,
    pub git_status: Option<GitStatus>,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub last_activity: Option<DateTime<Utc>>,
    pub is_stale: bool,
    /// Populated by [`gather_dependency_scan`]. `None` on the fast path.
    pub outdated: Option<OutdatedResult>,
    /// Populated by [`gather_dependency_scan`]. `None` on the fast path.
    pub audit: Option<AuditResult>,
    /// Slim license-scan summary used by the dashboard's `LicenseChip`
    /// and the workspace-wide `License risk` filter. `None` on the
    /// fast path; populated when [`gather_dependency_scan`] runs the
    /// license side-channel for this service or when the cold-start
    /// hydrator finds a persisted row in `dependency_scans.license_json`.
    pub license: Option<LicenseScanSummary>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OutdatedResult {
    pub total: usize,
    pub major: usize,
    pub minor: usize,
    pub patch: usize,
    /// Per-package detail so the UI can show "exactly which packages"
    /// without a follow-up request. Sorted major → minor → patch → other,
    /// then alphabetically within each bucket.
    pub packages: Vec<OutdatedPackage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutdatedPackage {
    pub name: String,
    pub current: String,
    pub latest: String,
    /// "major" / "minor" / "patch" — `None` when the bump couldn't be
    /// classified (non-semver, identical, etc.) rather than silently
    /// dropping the row.
    pub bump: Option<String>,
    /// Best-effort link to the package homepage / registry page. Used by
    /// the detail drawer to offer a "changelog" jump-off.
    pub homepage: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AuditResult {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
    /// One entry per advisory. One package can appear multiple times when
    /// it has multiple outstanding CVEs; deduplication is the UI's
    /// responsibility. Sorted by severity desc, then package name.
    pub advisories: Vec<Advisory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Advisory {
    /// CVE / GHSA / RUSTSEC identifier when present.
    pub id: Option<String>,
    pub package: String,
    /// Normalised to "critical" / "high" / "medium" / "low" / "info" so
    /// the frontend can colour-code without running an `if` per source.
    pub severity: String,
    pub title: String,
    pub url: Option<String>,
    pub vulnerable_range: Option<String>,
    pub fix_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverviewSummary {
    pub projects: Vec<ProjectOverview>,
    pub total_running: usize,
    pub total_stopped: usize,
    pub total_dirty: usize,
    pub total_behind: usize,
    pub total_cpu: f32,
    pub total_memory: u64,
    pub total_outdated: usize,
    pub total_vulnerabilities: usize,
    /// Workspace-wide aggregate of strong + network copyleft + proprietary
    /// licenses (i.e. `LicenseScanSummary::contamination_count`). Drives
    /// the hero headline's "N license risk" priority bucket and the
    /// workspace-level filter chip count. Weak copyleft and unknown
    /// are deliberately excluded — see the function-level
    /// rationale on `LicenseScanSummary::contamination_count`.
    pub total_license_warnings: usize,
    /// Number of projects that carry at least one strong/network
    /// copyleft or proprietary dependency. Used by the FilterBar
    /// chip ("License risk · 3 projects") so the count matches the
    /// roster size, not the package size.
    pub projects_with_license_risk: usize,
    pub stale_count: usize,
    /// `true` when at least one project in the list has non-`None`
    /// `outdated`/`audit`. Lets the UI show "scan dependencies" as a
    /// primary action vs "refresh" for returning users.
    pub has_dependency_scan: bool,
}

/// Incremental update returned by [`gather_dependency_scan`]. Maps a
/// service id to the scan result for that project so the frontend can
/// merge it into an existing [`OverviewSummary`] without a full refresh.
#[derive(Debug, Clone, Serialize)]
pub struct DependencyScanResult {
    pub entries: Vec<DependencyScanEntry>,
    pub total_outdated: usize,
    pub total_vulnerabilities: usize,
    /// Workspace-wide contamination count (`strong + network +
    /// proprietary`). See [`OverviewSummary::total_license_warnings`].
    pub total_license_warnings: usize,
    /// Workspace-wide strong-copyleft count (GPL/LGPL strong family
    /// excluding LGPL). Surfaced separately from
    /// `total_license_warnings` so the hero / WorstOffenders can
    /// special-case GPL contamination ("3 GPL packages will infect
    /// your tree") versus the softer proprietary case.
    pub total_strong_copyleft: usize,
    /// Workspace-wide network-copyleft count (AGPL / SSPL). Most
    /// commercially toxic class for SaaS — promoted to its own
    /// total so the dashboard can call it out.
    pub total_network_copyleft: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyScanEntry {
    pub service_id: String,
    pub outdated: Option<OutdatedResult>,
    pub audit: Option<AuditResult>,
    /// Slim license summary collected alongside outdated/audit. See
    /// [`LicenseScanSummary`] for why we ship a projection rather
    /// than the full result.
    pub license: Option<LicenseScanSummary>,
    /// Wall-clock timestamp when this individual project's scan
    /// completed, in epoch ms. Stamped per-entry rather than per-batch
    /// so a 30-project run still tells the UI "react app finished
    /// 14s before lodash app", which feeds the per-card "Last
    /// scanned 3h ago" chip.
    pub scanned_at_ms: i64,
    /// How long this single project's scan took (outdated + audit
    /// concurrent), in ms. `None` for cache hits — those are
    /// near-instant and reusing the original duration would lie about
    /// what the network just did.
    pub duration_ms: Option<i64>,
    /// `true` when the entry came straight out of the in-memory
    /// `ScanCache` rather than a fresh subprocess run. Lets the UI
    /// distinguish "you just rescanned" from "we reused a 4-minute-old
    /// result" and tone down the success toast accordingly.
    pub from_cache: bool,
    /// Total outdated count from the **previous** persisted scan for
    /// this project, when one exists. Drives the dashboard's
    /// "↑3 since last scan" delta badge — comparing live numbers
    /// against persisted ones is exactly the kind of "what's
    /// changed?" signal a power user wants when they trigger a
    /// rescan after running `npm install`. `None` means there's no
    /// prior row yet (first ever scan for this project) or this
    /// entry came from cache (in which case it IS the persisted row,
    /// so a delta would always be zero).
    pub previous_total_outdated: Option<i64>,
    pub previous_total_vulnerabilities: Option<i64>,
    /// Total contamination from the **previous** persisted scan
    /// (`strong + network + proprietary`). Drives a "+N license
    /// warnings since last scan" delta badge in the same spirit as
    /// the deps deltas. `None` for cache hits / first-ever scans
    /// for the same reasons documented on `previous_total_outdated`.
    pub previous_total_license_warnings: Option<i64>,
}
