//! Cross-project overview and aggregation.
//!
//! Provides a bird's-eye view across all registered services — git status,
//! resource sampling, last-activity detection, and optional dependency /
//! security scans.
//!
//! # Two-phase design
//!
//! Opening the dashboard should feel instant. But `npm outdated` / `cargo
//! audit` each routinely take 5–30 s per project, so running them inline
//! blocks the UI for minutes on a large workspace. The API is therefore
//! split in two:
//!
//! * [`gather_overview`] — **fast path**. Git status, process resource
//!   samples, staleness, and tags, all in-memory or trivial filesystem
//!   reads. Returns in ~tens of ms for typical sizes.
//! * [`gather_dependency_scan`] — **slow path**, opt-in. Spawns the
//!   `npm outdated` / `cargo outdated` / `npm audit` / ... commands in
//!   parallel with a hard timeout each, and memoises the result in a
//!   TTL cache so subsequent opens are instant.
//!
//! The frontend calls `gather_overview` on open and only triggers
//! `gather_dependency_scan` when the user explicitly clicks "Scan
//! dependencies" (or on an interval if they want).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::process::Command as TokioCommand;
use tokio::task::JoinSet;
use tokio::time::timeout;

use crate::error::AppResult;
use crate::git::{self, GitStatus};
use crate::process::Supervisor;
use crate::resources::ResourceSample;
use crate::scan_history::{PersistedScan, ScanHistoryDb};
use crate::state::Store;

/// Hard cap per external command. Exceeding this kills the child and
/// returns `None` — we'd rather miss a number than hang the UI.
const OUTDATED_TIMEOUT: Duration = Duration::from_secs(20);
const AUDIT_TIMEOUT: Duration = Duration::from_secs(25);

/// Dependency scan results are memoised for this long. Re-running
/// `npm outdated` across 20 projects every time the user toggles a filter
/// is wasteful; five minutes is a reasonable "coffee break" cadence that
/// still reflects recent `npm install`s when the user returns.
const SCAN_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

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
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyScanEntry {
    pub service_id: String,
    pub outdated: Option<OutdatedResult>,
    pub audit: Option<AuditResult>,
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
}

// ---- Helpers --------------------------------------------------------------

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Approximate the wall-clock millisecond timestamp at which the given
/// `Instant` was captured. We can't recover an exact wall time from a
/// monotonic instant — and we don't need to; the caller only uses this
/// to render "X minutes ago" labels — but we can subtract its
/// `elapsed()` from the current wall clock with low single-digit-ms
/// drift. Saturates at 0 on the off-chance the system clock jumped
/// backward enough to make the subtraction underflow.
fn ms_from_instant(inst: Instant) -> i64 {
    let elapsed = inst.elapsed().as_millis() as i64;
    now_ms().saturating_sub(elapsed).max(0)
}

// ---- Fast path ------------------------------------------------------------

pub async fn gather_overview(
    store: &Store,
    supervisor: &Supervisor,
    stale_threshold_days: i64,
) -> AppResult<OverviewSummary> {
    gather_overview_with_history(store, supervisor, stale_threshold_days, None).await
}

/// Same as [`gather_overview`] but also seeds each project's
/// `outdated` / `audit` from the persistent scan-history DB at
/// `scan_history_db_path` when the in-memory `ScanCache` doesn't have
/// a fresh entry for it.
///
/// The point of this is the **cold-start dashboard**: before this lived
/// here, after a desktop restart the user faced empty audit chips for
/// 30 seconds while `npm audit` re-ran across the workspace, even
/// though we'd just persisted last night's results to disk. Now we
/// hydrate from SQLite synchronously on the fast path so the chip
/// renders with "12 advisories • last scanned 2h ago" immediately,
/// and a background rescan can refresh it.
///
/// Layered priority is intentional:
///   1. In-memory `ScanCache` (TTL 5min) — freshest, includes any
///      result the user kicked off seconds ago.
///   2. SQLite `dependency_scans` (no TTL) — survives restarts,
///      arbitrarily old.
///   3. `None` — show "scan dependencies" CTA.
///
/// We don't *replace* an in-memory entry with an older SQLite one;
/// SQLite only fills the gap. Otherwise refreshing the dashboard
/// during a scan would visibly time-travel.
pub async fn gather_overview_with_history(
    store: &Store,
    supervisor: &Supervisor,
    stale_threshold_days: i64,
    scan_history_db_path: Option<&Path>,
) -> AppResult<OverviewSummary> {
    let services = store.services();
    let cutoff = Utc::now() - chrono::Duration::days(stale_threshold_days);

    // Open and slurp the persisted scans up-front so the per-project
    // loop below can do a constant-time lookup. The DB is small
    // (one row per service, JSON blobs in the low KBs each) so a
    // single list-all is cheaper than a query per service.
    let persisted_by_id: HashMap<String, PersistedScan> = match scan_history_db_path {
        Some(path) => match ScanHistoryDb::open(path) {
            Ok(db) => match db.list_all() {
                Ok(rows) => rows
                    .into_iter()
                    .map(|r| (r.service_id.clone(), r))
                    .collect(),
                Err(e) => {
                    tracing::warn!("scan history list_all failed: {e}");
                    HashMap::new()
                }
            },
            Err(e) => {
                tracing::warn!("scan history open failed: {e}");
                HashMap::new()
            }
        },
        None => HashMap::new(),
    };

    // Fire cheap per-service git lookups in parallel: on a workspace with
    // 20 repos, sequential git-status adds up to hundreds of ms.
    let git_tasks: Vec<_> = services
        .iter()
        .map(|svc| {
            let cwd = svc.cwd.clone();
            let id = svc.id.clone();
            tokio::task::spawn_blocking(move || (id, git::status(&cwd)))
        })
        .collect();

    let mut git_by_id: HashMap<String, Option<GitStatus>> = HashMap::new();
    for task in git_tasks {
        if let Ok((id, status)) = task.await {
            git_by_id.insert(id, status);
        }
    }

    let scan_cache = ScanCache::global();
    let scan_snapshot = scan_cache.snapshot();

    let mut projects = Vec::with_capacity(services.len());
    let mut total_running = 0usize;
    let mut total_stopped = 0usize;
    let mut total_dirty = 0usize;
    let mut total_behind = 0usize;
    let mut total_cpu = 0.0f32;
    let mut total_memory = 0u64;
    let mut total_outdated = 0usize;
    let mut total_vulnerabilities = 0usize;
    let mut stale_count = 0usize;
    let mut has_dependency_scan = false;

    for svc in &services {
        let is_running = supervisor.is_running(&svc.id);
        if is_running {
            total_running += 1;
        } else {
            total_stopped += 1;
        }

        let git_status = git_by_id.remove(&svc.id).unwrap_or(None);
        if let Some(ref gs) = git_status {
            if gs.is_dirty {
                total_dirty += 1;
            }
            if gs.behind > 0 {
                total_behind += 1;
            }
        }

        let (cpu_percent, memory_bytes) = supervisor
            .get_resources(&svc.id)
            .map(
                |ResourceSample {
                     cpu_percent,
                     memory_bytes,
                 }| (cpu_percent, memory_bytes),
            )
            .unwrap_or((0.0, 0));
        total_cpu += cpu_percent;
        total_memory += memory_bytes;

        let last_activity = git_status.as_ref().and_then(|gs| {
            gs.last_commit
                .as_ref()
                .map(|c| DateTime::from_timestamp(c.timestamp, 0).unwrap_or_else(Utc::now))
        });
        let is_stale = last_activity.map_or(true, |la| la < cutoff);
        if is_stale {
            stale_count += 1;
        }

        let runtime = detect_runtime(&svc.cwd);

        // Reuse last scan result if it's still within TTL. This lets the
        // user close and reopen the dashboard without paying the full
        // scan cost each time.
        let (mut outdated, mut audit) = scan_snapshot
            .get(&svc.cwd)
            .map(|e| (e.outdated.clone(), e.audit.clone()))
            .unwrap_or((None, None));

        // Fall back to the persistent scan history when the in-memory
        // cache doesn't cover this service (the typical cold-start
        // case). We stitch outdated and audit independently because
        // some runtimes only persist one of the two — losing both
        // because one was missing would defeat the whole hydration.
        if outdated.is_none() || audit.is_none() {
            if let Some(persisted) = persisted_by_id.get(&svc.id) {
                if outdated.is_none() {
                    outdated = persisted.outdated.clone();
                }
                if audit.is_none() {
                    audit = persisted.audit.clone();
                }
            }
        }

        if outdated.is_some() || audit.is_some() {
            has_dependency_scan = true;
        }
        if let Some(ref o) = outdated {
            total_outdated += o.total;
        }
        if let Some(ref a) = audit {
            total_vulnerabilities += a.critical + a.high + a.medium + a.low;
        }

        projects.push(ProjectOverview {
            service_id: svc.id.clone(),
            name: svc.name.clone(),
            cwd: svc.cwd.to_string_lossy().to_string(),
            runtime,
            is_running,
            git_status,
            cpu_percent,
            memory_bytes,
            last_activity,
            is_stale,
            outdated,
            audit,
            tags: svc.tags.clone(),
        });
    }

    Ok(OverviewSummary {
        projects,
        total_running,
        total_stopped,
        total_dirty,
        total_behind,
        total_cpu,
        total_memory,
        total_outdated,
        total_vulnerabilities,
        stale_count,
        has_dependency_scan,
    })
}

// ---- Slow path (opt-in dependency scan) -----------------------------------

/// Run `npm outdated` / `cargo audit` / ... for every registered service,
/// in parallel, with per-command timeouts. Results are cached for
/// [`SCAN_CACHE_TTL`] and picked up by subsequent [`gather_overview`]
/// calls.
///
/// If `force` is false, projects whose cached entry is still fresh are
/// skipped entirely. Pass `force = true` from an explicit "refresh" action
/// to bypass the cache.
pub async fn gather_dependency_scan(store: &Store, force: bool) -> AppResult<DependencyScanResult> {
    gather_dependency_scan_with_history(store, force, None).await
}

/// Same as [`gather_dependency_scan`] but additionally upserts every
/// fresh per-service result into the persistent SQLite scan history at
/// `scan_history_db_path` so subsequent dashboard cold-starts can
/// hydrate the chips immediately without rerunning the tools.
///
/// Cache hits are *not* re-persisted — they were already written when
/// the original run completed, and rewriting them would only update
/// the timestamp, falsely advertising "scanned 30s ago" to the user
/// when nothing actually ran.
pub async fn gather_dependency_scan_with_history(
    store: &Store,
    force: bool,
    scan_history_db_path: Option<&Path>,
) -> AppResult<DependencyScanResult> {
    let services = store.services();
    let scan_cache = ScanCache::global();

    // Snapshot of (id, name, cwd) so the JoinSet tasks can persist
    // back without holding a Store reference (Store isn't `Send` past
    // an .await, and plumbing it through the JoinSet would require
    // an Arc clone we don't otherwise need).
    let svc_meta: HashMap<String, (String, PathBuf)> = services
        .iter()
        .map(|s| (s.id.clone(), (s.name.clone(), s.cwd.clone())))
        .collect();

    let mut tasks: JoinSet<DependencyScanEntry> = JoinSet::new();
    for svc in &services {
        let service_id = svc.id.clone();
        let cwd = svc.cwd.clone();
        let runtime = detect_runtime(&svc.cwd);

        // Serve from cache when fresh, so large workspaces don't re-run
        // heavy external commands on every click.
        if !force {
            if let Some(entry) = scan_cache.get_fresh(&cwd) {
                let scanned_at_ms = ms_from_instant(entry.fetched_at);
                tasks.spawn(async move {
                    DependencyScanEntry {
                        service_id,
                        outdated: entry.outdated,
                        audit: entry.audit,
                        scanned_at_ms,
                        duration_ms: None,
                        from_cache: true,
                        previous_total_outdated: None,
                        previous_total_vulnerabilities: None,
                    }
                });
                continue;
            }
        }

        let cache = scan_cache.clone();
        tasks.spawn(async move {
            let started = Instant::now();
            let outdated_fut = run_outdated(&cwd, runtime.as_deref());
            let audit_fut = run_audit(&cwd, runtime.as_deref());
            let (outdated, audit) = tokio::join!(outdated_fut, audit_fut);
            let duration_ms = started.elapsed().as_millis() as i64;
            cache.insert(&cwd, outdated.clone(), audit.clone());
            DependencyScanEntry {
                service_id,
                outdated,
                audit,
                scanned_at_ms: now_ms(),
                duration_ms: Some(duration_ms),
                from_cache: false,
                previous_total_outdated: None,
                previous_total_vulnerabilities: None,
            }
        });
    }

    // Open the history DB lazily — only if a path is supplied. Failing
    // to open it must NOT abort the scan; the user still gets live
    // results in the UI, we just lose the persistence side-effect for
    // this run. A loud warn-log makes the fallout debuggable.
    let history_db: Option<ScanHistoryDb> = scan_history_db_path.and_then(|path| {
        ScanHistoryDb::open(path)
            .map_err(|e| {
                tracing::warn!("scan history open failed (skipping persistence): {e}");
                e
            })
            .ok()
    });

    let mut entries = Vec::with_capacity(services.len());
    let mut total_outdated = 0usize;
    let mut total_vulnerabilities = 0usize;
    while let Some(res) = tasks.join_next().await {
        let Ok(mut entry) = res else { continue };
        if let Some(ref o) = entry.outdated {
            total_outdated += o.total;
        }
        if let Some(ref a) = entry.audit {
            total_vulnerabilities += a.critical + a.high + a.medium + a.low;
        }

        // Persist fresh runs only — see function-level docstring for
        // why cache hits are skipped. We tolerate a failed write per
        // entry because losing one row's persistence is much better
        // than losing the whole batch's UI update.
        if !entry.from_cache {
            if let (Some(db), Some((name, cwd))) = (
                history_db.as_ref(),
                svc_meta.get(&entry.service_id).cloned(),
            ) {
                // Read the prior row BEFORE upsert so we can stamp
                // a "what changed" delta onto the entry. Used by the
                // dashboard to render "+3 advisories since last
                // scan" — the kind of signal that converts a passive
                // "scan deps" affordance into an active risk
                // notification. Skipped for first-ever scans (no
                // prior row, deltas remain None).
                if let Ok(Some(prev)) = db.get_by_service(&entry.service_id) {
                    entry.previous_total_outdated = Some(prev.total_outdated);
                    entry.previous_total_vulnerabilities = Some(prev.total_vulnerabilities);
                }

                let entry_total_outdated =
                    entry.outdated.as_ref().map(|o| o.total).unwrap_or(0) as i64;
                let entry_total_vulns = entry
                    .audit
                    .as_ref()
                    .map(|a| a.critical + a.high + a.medium + a.low)
                    .unwrap_or(0) as i64;
                let scan_row = PersistedScan {
                    service_id: entry.service_id.clone(),
                    cwd: cwd.to_string_lossy().to_string(),
                    service_name: name,
                    outdated: entry.outdated.clone(),
                    audit: entry.audit.clone(),
                    scanned_at_ms: entry.scanned_at_ms,
                    duration_ms: entry.duration_ms,
                    total_outdated: entry_total_outdated,
                    total_vulnerabilities: entry_total_vulns,
                };
                if let Err(e) = db.upsert(&scan_row) {
                    tracing::warn!(
                        service_id = %entry.service_id,
                        "scan history upsert failed: {e}"
                    );
                }
            }
        }

        entries.push(entry);
    }

    Ok(DependencyScanResult {
        entries,
        total_outdated,
        total_vulnerabilities,
    })
}

/// Single-service variant of [`gather_dependency_scan_with_history`].
///
/// Lets the UI offer a "Rescan this project" affordance that doesn't
/// have to wait on every other registered service to finish — a real
/// concern on a 30-project workspace where running the full suite
/// just to verify a `lodash` advisory takes a coffee break.
///
/// `force` semantics match the batch variant: skipped when the
/// in-memory cache is fresh, unless the caller explicitly asks to
/// bypass it.
///
/// Returns `Ok(None)` when the supplied `service_id` doesn't match
/// any registered service — the IPC layer turns that into a 404-style
/// "no such service" error rather than a silent empty result.
pub async fn gather_dependency_scan_for_service(
    store: &Store,
    service_id: &str,
    force: bool,
    scan_history_db_path: Option<&Path>,
) -> AppResult<Option<DependencyScanEntry>> {
    let services = store.services();
    let Some(svc) = services.iter().find(|s| s.id == service_id) else {
        return Ok(None);
    };
    let svc_id = svc.id.clone();
    let svc_name = svc.name.clone();
    let cwd = svc.cwd.clone();
    let runtime = detect_runtime(&svc.cwd);

    let scan_cache = ScanCache::global();

    // Fast cache path — same shape as the batch variant. Cache hits
    // get a None duration and `from_cache: true` so the UI can avoid
    // claiming "scan completed in 0.0s" when nothing actually ran.
    if !force {
        if let Some(cached) = scan_cache.get_fresh(&cwd) {
            return Ok(Some(DependencyScanEntry {
                service_id: svc_id,
                outdated: cached.outdated,
                audit: cached.audit,
                scanned_at_ms: ms_from_instant(cached.fetched_at),
                duration_ms: None,
                from_cache: true,
                previous_total_outdated: None,
                previous_total_vulnerabilities: None,
            }));
        }
    }

    let started = Instant::now();
    let outdated_fut = run_outdated(&cwd, runtime.as_deref());
    let audit_fut = run_audit(&cwd, runtime.as_deref());
    let (outdated, audit) = tokio::join!(outdated_fut, audit_fut);
    let duration_ms = started.elapsed().as_millis() as i64;
    scan_cache.insert(&cwd, outdated.clone(), audit.clone());

    let mut entry = DependencyScanEntry {
        service_id: svc_id.clone(),
        outdated: outdated.clone(),
        audit: audit.clone(),
        scanned_at_ms: now_ms(),
        duration_ms: Some(duration_ms),
        from_cache: false,
        previous_total_outdated: None,
        previous_total_vulnerabilities: None,
    };

    if let Some(path) = scan_history_db_path {
        if let Ok(db) = ScanHistoryDb::open(path).map_err(|e| {
            tracing::warn!("scan history open failed (single scan persistence skipped): {e}");
            e
        }) {
            // Capture deltas before the upsert clobbers the prior
            // row — same trick as the batch variant, kept inline
            // here so the function reads top-to-bottom without a
            // helper round-trip.
            if let Ok(Some(prev)) = db.get_by_service(&svc_id) {
                entry.previous_total_outdated = Some(prev.total_outdated);
                entry.previous_total_vulnerabilities = Some(prev.total_vulnerabilities);
            }

            let total_outdated = outdated.as_ref().map(|o| o.total).unwrap_or(0) as i64;
            let total_vulns = audit
                .as_ref()
                .map(|a| a.critical + a.high + a.medium + a.low)
                .unwrap_or(0) as i64;
            let scan_row = PersistedScan {
                service_id: svc_id,
                cwd: cwd.to_string_lossy().to_string(),
                service_name: svc_name,
                outdated,
                audit,
                scanned_at_ms: entry.scanned_at_ms,
                duration_ms: entry.duration_ms,
                total_outdated,
                total_vulnerabilities: total_vulns,
            };
            if let Err(e) = db.upsert(&scan_row) {
                tracing::warn!(
                    service_id = %entry.service_id,
                    "single scan history upsert failed: {e}"
                );
            }
        }
    }

    Ok(Some(entry))
}

async fn run_outdated(cwd: &Path, runtime: Option<&str>) -> Option<OutdatedResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_outdated(cwd).await,
        "rust" => check_cargo_outdated(cwd).await,
        "go" => check_go_outdated(cwd).await,
        _ => None,
    }
}

async fn run_audit(cwd: &Path, runtime: Option<&str>) -> Option<AuditResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_audit(cwd).await,
        "rust" => check_cargo_audit(cwd).await,
        "python" => check_pip_audit(cwd).await,
        _ => None,
    }
}

// ---- Runtime detection ----------------------------------------------------

fn detect_runtime(cwd: &Path) -> Option<String> {
    if cwd.join("package.json").exists() {
        if cwd.join("bun.lockb").exists() {
            Some("bun".into())
        } else if cwd.join("deno.lock").exists() {
            Some("deno".into())
        } else {
            Some("node".into())
        }
    } else if cwd.join("Cargo.toml").exists() {
        Some("rust".into())
    } else if cwd.join("go.mod").exists() {
        Some("go".into())
    } else if cwd.join("pom.xml").exists() || cwd.join("build.gradle").exists() {
        Some("java".into())
    } else if cwd.join("requirements.txt").exists() || cwd.join("pyproject.toml").exists() {
        Some("python".into())
    } else if cwd.join("Gemfile").exists() {
        Some("ruby".into())
    } else if cwd.join("composer.json").exists() {
        Some("php".into())
    } else {
        None
    }
}

// ---- Outdated checkers ----------------------------------------------------

async fn check_npm_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed("npm", &["outdated", "--json"], cwd, OUTDATED_TIMEOUT).await?;
    parse_npm_outdated(&output)
}

fn parse_npm_outdated(stdout: &[u8]) -> Option<OutdatedResult> {
    let s = String::from_utf8_lossy(stdout);
    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Some(OutdatedResult::default());
    }
    let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = val.as_object()?;
    let mut packages: Vec<OutdatedPackage> = Vec::with_capacity(obj.len());
    for (name, info) in obj {
        let Some(info_obj) = info.as_object() else {
            continue;
        };
        let current = info_obj
            .get("current")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = info_obj
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let homepage = info_obj
            .get("homepage")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| Some(format!("https://www.npmjs.com/package/{name}")));
        packages.push(OutdatedPackage {
            name: name.clone(),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            current,
            latest,
            homepage,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}

#[derive(Debug, PartialEq)]
enum SemverBump {
    Major,
    Minor,
    Patch,
}

impl SemverBump {
    fn as_str(&self) -> &'static str {
        match self {
            SemverBump::Major => "major",
            SemverBump::Minor => "minor",
            SemverBump::Patch => "patch",
        }
    }
}

impl OutdatedResult {
    /// Build a result from a flat package list. Handles counting and the
    /// canonical sort order (major → minor → patch → other, alpha within)
    /// so every parser emits a stable shape.
    fn from_packages(mut packages: Vec<OutdatedPackage>) -> Self {
        let mut major = 0usize;
        let mut minor = 0usize;
        let mut patch = 0usize;
        for p in &packages {
            match p.bump.as_deref() {
                Some("major") => major += 1,
                Some("minor") => minor += 1,
                Some("patch") => patch += 1,
                _ => {}
            }
        }
        packages.sort_by(|a, b| {
            fn rank(b: &Option<String>) -> u8 {
                match b.as_deref() {
                    Some("major") => 0,
                    Some("minor") => 1,
                    Some("patch") => 2,
                    _ => 3,
                }
            }
            rank(&a.bump)
                .cmp(&rank(&b.bump))
                .then_with(|| a.name.cmp(&b.name))
        });
        OutdatedResult {
            total: packages.len(),
            major,
            minor,
            patch,
            packages,
        }
    }
}

impl AuditResult {
    fn from_advisories(mut advisories: Vec<Advisory>) -> Self {
        let mut result = AuditResult::default();
        for a in &advisories {
            match a.severity.as_str() {
                "critical" => result.critical += 1,
                "high" => result.high += 1,
                "medium" => result.medium += 1,
                "low" => result.low += 1,
                "info" => result.info += 1,
                _ => {}
            }
        }
        advisories.sort_by(|a, b| {
            severity_rank(&a.severity)
                .cmp(&severity_rank(&b.severity))
                .then_with(|| a.package.cmp(&b.package))
        });
        result.advisories = advisories;
        result
    }
}

/// Normalise severity strings across tools: `moderate` (npm) and `medium`
/// (cargo/pip) collapse to the same bucket.
fn normalize_severity(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().as_str() {
        "critical" => "critical",
        "high" => "high",
        "moderate" | "medium" => "medium",
        "low" => "low",
        "info" | "informational" => "info",
        _ => "low",
    }
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

/// Classify the delta between `current` and `latest` as major/minor/patch.
///
/// Only positive (forward) deltas count; returns `None` when the versions
/// are equal, malformed, or `latest <= current` (local checkout is newer
/// than the registry — a rare but valid situation during development).
fn semver_diff(current: &str, latest: &str) -> Option<SemverBump> {
    fn parse(v: &str) -> Option<(u64, u64, u64)> {
        // Strip a leading `v` or semver pre-release/build suffix so the
        // comparison is on the core triplet.
        let core = v.trim_start_matches('v');
        let core = core.split(['-', '+']).next().unwrap_or(core);
        let parts: Vec<u64> = core.split('.').filter_map(|s| s.parse().ok()).collect();
        match parts.as_slice() {
            [a] => Some((*a, 0, 0)),
            [a, b] => Some((*a, *b, 0)),
            [a, b, c, ..] => Some((*a, *b, *c)),
            _ => None,
        }
    }

    let (c_maj, c_min, c_pat) = parse(current)?;
    let (l_maj, l_min, l_pat) = parse(latest)?;

    if l_maj > c_maj {
        Some(SemverBump::Major)
    } else if l_maj == c_maj && l_min > c_min {
        Some(SemverBump::Minor)
    } else if l_maj == c_maj && l_min == c_min && l_pat > c_pat {
        Some(SemverBump::Patch)
    } else {
        None
    }
}

async fn check_cargo_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "cargo",
        &["outdated", "--format", "json"],
        cwd,
        OUTDATED_TIMEOUT,
    )
    .await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let pkgs = val.get("dependencies").and_then(|v| v.as_array())?;
    let mut packages = Vec::with_capacity(pkgs.len());
    for pkg in pkgs {
        let name = pkg
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = pkg
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = pkg
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if latest.is_empty() || latest == current || name.is_empty() {
            continue;
        }
        packages.push(OutdatedPackage {
            homepage: Some(format!("https://crates.io/crates/{name}")),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            name,
            current,
            latest,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}

async fn check_go_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "go",
        &["list", "-u", "-m", "-json", "all"],
        cwd,
        OUTDATED_TIMEOUT,
    )
    .await?;
    let s = String::from_utf8_lossy(&output);
    let mut packages: Vec<OutdatedPackage> = Vec::new();
    // `go list -json` emits a stream of concatenated objects; walk it with
    // a streaming deserialiser rather than per-line `from_str`, which
    // misparses when an object spans multiple lines.
    let stream = serde_json::Deserializer::from_str(&s).into_iter::<serde_json::Value>();
    for val in stream.flatten() {
        let Some(update) = val.get("Update") else {
            continue;
        };
        let name = val
            .get("Path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = val
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = update
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        packages.push(OutdatedPackage {
            homepage: Some(format!("https://pkg.go.dev/{name}")),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            name,
            current,
            latest,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}

// ---- Audit checkers -------------------------------------------------------

async fn check_npm_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("npm", &["audit", "--json"], cwd, AUDIT_TIMEOUT).await?;
    parse_npm_audit(&output)
}

fn parse_npm_audit(stdout: &[u8]) -> Option<AuditResult> {
    let s = String::from_utf8_lossy(stdout);
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let mut advisories: Vec<Advisory> = Vec::new();

    // npm v7+ format: a `vulnerabilities` map keyed by package name, with
    // each entry carrying a `via` array where the entries are either
    // nested advisory objects or strings pointing to another offending
    // package. We only keep the object variants — string `via`s are
    // transitive and their content is already represented by the referenced
    // entry.
    if let Some(vulns) = val.get("vulnerabilities").and_then(|v| v.as_object()) {
        for (pkg_name, entry) in vulns {
            let fix_version = entry.get("fixAvailable").and_then(|f| match f {
                serde_json::Value::Object(o) => o
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                _ => None,
            });
            let range = entry
                .get("range")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if let Some(via) = entry.get("via").and_then(|v| v.as_array()) {
                for v in via {
                    let Some(obj) = v.as_object() else { continue };
                    let severity = normalize_severity(
                        obj.get("severity").and_then(|s| s.as_str()).unwrap_or(""),
                    )
                    .to_string();
                    let title = obj
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Vulnerability")
                        .to_string();
                    let id = obj
                        .get("url")
                        .and_then(|u| u.as_str())
                        .and_then(|u| u.rsplit('/').next())
                        .map(str::to_string);
                    let url = obj.get("url").and_then(|v| v.as_str()).map(str::to_string);
                    advisories.push(Advisory {
                        id,
                        package: pkg_name.clone(),
                        severity,
                        title,
                        url,
                        vulnerable_range: range.clone(),
                        fix_version: fix_version.clone(),
                    });
                }
            }
        }
        if !advisories.is_empty() {
            return Some(AuditResult::from_advisories(advisories));
        }
    }

    // npm v6 format: a flat map of advisory objects keyed by numeric id.
    if let Some(obj) = val.get("advisories").and_then(|v| v.as_object()) {
        for (key, adv) in obj {
            let severity =
                normalize_severity(adv.get("severity").and_then(|v| v.as_str()).unwrap_or(""))
                    .to_string();
            let package = adv
                .get("module_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = adv
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Vulnerability")
                .to_string();
            let url = adv.get("url").and_then(|v| v.as_str()).map(str::to_string);
            let range = adv
                .get("vulnerable_versions")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let fix_version = adv
                .get("patched_versions")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            advisories.push(Advisory {
                id: Some(key.clone()),
                package,
                severity,
                title,
                url,
                vulnerable_range: range,
                fix_version,
            });
        }
        return Some(AuditResult::from_advisories(advisories));
    }

    // No advisories section at all but the file is valid JSON: fall back
    // to metadata counts so we at least render the rolled-up summary.
    // Caller treats an empty advisories list plus non-zero counts as
    // "counts without detail" and shows a hint instead of a table.
    if let Some(m) = val
        .get("metadata")
        .and_then(|m| m.get("vulnerabilities"))
        .and_then(|v| v.as_object())
    {
        let count = |key: &str| m.get(key).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        return Some(AuditResult {
            critical: count("critical"),
            high: count("high"),
            // npm audit uses "moderate" where our schema uses "medium" —
            // single source of truth for that rename sits here.
            medium: count("moderate"),
            low: count("low"),
            info: count("info"),
            ..AuditResult::default()
        });
    }

    Some(AuditResult::default())
}

async fn check_cargo_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("cargo", &["audit", "--json"], cwd, AUDIT_TIMEOUT).await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let list = val
        .get("vulnerabilities")
        .and_then(|v| v.get("list"))
        .and_then(|v| v.as_array())?;
    let mut advisories = Vec::with_capacity(list.len());
    for vuln in list {
        let adv = vuln.get("advisory");
        let id = adv
            .and_then(|a| a.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let package = adv
            .and_then(|a| a.get("package"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = adv
            .and_then(|a| a.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("Advisory")
            .to_string();
        let url = adv
            .and_then(|a| a.get("url"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| {
                id.as_ref()
                    .map(|i| format!("https://rustsec.org/advisories/{i}"))
            });
        // `cargo audit` does not always set a severity; fall back to "low"
        // so the count still surfaces rather than silently dropping.
        let severity_raw = adv
            .and_then(|a| a.get("severity"))
            .and_then(|v| v.as_str())
            .unwrap_or("low");
        let severity = normalize_severity(severity_raw).to_string();
        let fix_version = vuln
            .get("versions")
            .and_then(|v| v.get("patched"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let vulnerable_range = vuln
            .get("affected")
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(str::to_string);
        advisories.push(Advisory {
            id,
            package,
            severity,
            title,
            url,
            vulnerable_range,
            fix_version,
        });
    }
    Some(AuditResult::from_advisories(advisories))
}

async fn check_pip_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("pip-audit", &["--format", "json"], cwd, AUDIT_TIMEOUT).await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let deps = val.as_array()?;
    let mut advisories: Vec<Advisory> = Vec::new();
    for dep in deps {
        let package = dep
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = dep
            .get("version")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let Some(vulns) = dep.get("vulns").and_then(|v| v.as_array()) else {
            continue;
        };
        for vuln in vulns {
            let id = vuln.get("id").and_then(|v| v.as_str()).map(str::to_string);
            let severity = normalize_severity(
                vuln.get("severity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("low"),
            )
            .to_string();
            let title = vuln
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.lines().next().unwrap_or(s).to_string())
                .unwrap_or_else(|| "Vulnerability".to_string());
            let url = id.as_ref().map(|i| {
                if i.starts_with("CVE-") {
                    format!("https://nvd.nist.gov/vuln/detail/{i}")
                } else if i.starts_with("GHSA-") {
                    format!("https://github.com/advisories/{i}")
                } else {
                    format!("https://osv.dev/vulnerability/{i}")
                }
            });
            let fix_version = vuln
                .get("fix_versions")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
                .map(str::to_string);
            advisories.push(Advisory {
                id,
                package: package.clone(),
                severity,
                title,
                url,
                vulnerable_range: current.clone(),
                fix_version,
            });
        }
    }
    Some(AuditResult::from_advisories(advisories))
}

// ---- Subprocess runner with real timeout ----------------------------------

/// Spawn an external command and collect its stdout, enforcing a hard
/// timeout. If the deadline passes, the child is killed and we return
/// `None`. `stderr` is discarded — these CLIs emit progress chatter that
/// we don't need and which would crowd the buffer.
async fn run_timed(
    program: &str,
    args: &[&str],
    cwd: &Path,
    deadline: Duration,
) -> Option<Vec<u8>> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args)
        .current_dir(cwd)
        // Running git inside a service cwd inherits the parent's GIT_*
        // env when launched via `cargo run`; stripping them here stops
        // `npm audit` from accidentally reading this process's git repo.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    let child = cmd.spawn().ok()?;

    match timeout(deadline, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            // Many of these commands exit non-zero to signal "work to do"
            // rather than failure — `npm outdated` returns 1 when packages
            // are outdated. Use stdout presence as the real success
            // signal.
            if output.stdout.is_empty() && !output.status.success() {
                None
            } else {
                Some(output.stdout)
            }
        }
        Ok(Err(_)) => None,
        Err(_) => {
            // Timed out. `wait_with_output` already consumed the child; we
            // rely on `kill_on_drop` to tear it down when the owning Child
            // is dropped (which happens as `output` goes out of scope via
            // the `?` above, or here as `cmd` is dropped).
            tracing::warn!(program, ?cwd, ?deadline, "overview command timed out");
            None
        }
    }
}

// ---- Scan cache -----------------------------------------------------------

#[derive(Clone)]
struct ScanEntry {
    outdated: Option<OutdatedResult>,
    audit: Option<AuditResult>,
    fetched_at: Instant,
}

#[derive(Clone)]
struct ScanCache {
    inner: Arc<Mutex<HashMap<PathBuf, ScanEntry>>>,
    // TTL is a field rather than reading the global constant directly so tests
    // can drive expiry with a tiny duration + real sleep. Backdating `Instant`
    // values underflows on fresh Windows CI runners where `Instant::now()` is
    // smaller than `SCAN_CACHE_TTL`, so we avoid that construction entirely.
    ttl: Duration,
}

impl ScanCache {
    fn global() -> Self {
        use std::sync::OnceLock;
        static GLOBAL: OnceLock<ScanCache> = OnceLock::new();
        GLOBAL
            .get_or_init(|| ScanCache {
                inner: Arc::new(Mutex::new(HashMap::new())),
                ttl: SCAN_CACHE_TTL,
            })
            .clone()
    }

    fn get_fresh(&self, cwd: &Path) -> Option<ScanEntry> {
        let guard = self.inner.lock();
        let entry = guard.get(cwd)?;
        if entry.fetched_at.elapsed() < self.ttl {
            Some(entry.clone())
        } else {
            None
        }
    }

    fn snapshot(&self) -> HashMap<PathBuf, ScanEntry> {
        let guard = self.inner.lock();
        guard
            .iter()
            .filter(|(_, e)| e.fetched_at.elapsed() < self.ttl)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    fn insert(&self, cwd: &Path, outdated: Option<OutdatedResult>, audit: Option<AuditResult>) {
        self.inner.lock().insert(
            cwd.to_path_buf(),
            ScanEntry {
                outdated,
                audit,
                fetched_at: Instant::now(),
            },
        );
    }
}

// ---- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_runtime_node() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("node".into()));
    }

    #[test]
    fn detect_runtime_rust() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"t\"\n").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("rust".into()));
    }

    #[test]
    fn detect_runtime_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detect_runtime(dir.path()), None);
    }

    #[test]
    fn detect_runtime_bun() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("bun.lockb"), "").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("bun".into()));
    }

    #[test]
    fn parse_npm_outdated_empty() {
        let result = parse_npm_outdated(b"{}").unwrap();
        assert_eq!(result.total, 0);
        assert!(result.packages.is_empty());
    }

    #[test]
    fn parse_npm_outdated_mixed_bumps() {
        let json = br#"{
            "lodash":  {"current": "1.0.0", "latest": "2.0.0"},
            "react":   {"current": "18.0.0", "latest": "18.1.0"},
            "express": {"current": "4.18.1", "latest": "4.18.2"}
        }"#;
        let result = parse_npm_outdated(json).unwrap();
        assert_eq!(result.total, 3);
        assert_eq!(result.major, 1);
        assert_eq!(result.minor, 1);
        assert_eq!(result.patch, 1);
        // Sorted major → minor → patch so the UI can render in that order
        // without a second pass.
        assert_eq!(result.packages[0].name, "lodash");
        assert_eq!(result.packages[0].bump.as_deref(), Some("major"));
        assert_eq!(result.packages[0].current, "1.0.0");
        assert_eq!(result.packages[0].latest, "2.0.0");
        assert_eq!(result.packages[1].name, "react");
        assert_eq!(result.packages[2].name, "express");
        // Homepage defaults to the npmjs page when `homepage` is absent.
        assert!(result.packages[0]
            .homepage
            .as_deref()
            .unwrap()
            .starts_with("https://www.npmjs.com/package/"));
    }

    #[test]
    fn parse_npm_audit_v7_via_advisories() {
        let json = br#"{
            "vulnerabilities": {
                "lodash": {
                    "name": "lodash",
                    "severity": "high",
                    "range": "<4.17.21",
                    "via": [
                        {
                            "source": 1094083,
                            "name": "lodash",
                            "title": "Prototype Pollution in lodash",
                            "url": "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
                            "severity": "high",
                            "range": "<4.17.21"
                        }
                    ],
                    "fixAvailable": {
                        "name": "lodash",
                        "version": "4.17.21",
                        "isSemVerMajor": false
                    }
                }
            }
        }"#;
        let result = parse_npm_audit(json).unwrap();
        assert_eq!(result.high, 1);
        assert_eq!(result.advisories.len(), 1);
        let a = &result.advisories[0];
        assert_eq!(a.package, "lodash");
        assert_eq!(a.severity, "high");
        assert_eq!(a.id.as_deref(), Some("GHSA-35jh-r3h4-6jhm"));
        assert_eq!(a.fix_version.as_deref(), Some("4.17.21"));
        assert_eq!(a.vulnerable_range.as_deref(), Some("<4.17.21"));
    }

    #[test]
    fn parse_npm_audit_metadata_fallback_without_advisories() {
        // Legacy or aggregated output: only metadata counts present.
        let json = br#"{
            "metadata": {
                "vulnerabilities": {
                    "critical": 1, "high": 2, "moderate": 3, "low": 0, "info": 0
                }
            }
        }"#;
        let result = parse_npm_audit(json).unwrap();
        assert_eq!(result.critical, 1);
        assert_eq!(result.high, 2);
        assert_eq!(result.medium, 3);
        assert!(result.advisories.is_empty());
    }

    #[test]
    fn semver_diff_major() {
        assert_eq!(semver_diff("1.2.3", "2.0.0"), Some(SemverBump::Major));
    }

    #[test]
    fn semver_diff_minor() {
        assert_eq!(semver_diff("1.2.3", "1.3.0"), Some(SemverBump::Minor));
    }

    #[test]
    fn semver_diff_patch() {
        assert_eq!(semver_diff("1.2.3", "1.2.4"), Some(SemverBump::Patch));
    }

    #[test]
    fn semver_diff_equal_is_none() {
        assert_eq!(semver_diff("1.2.3", "1.2.3"), None);
    }

    #[test]
    fn semver_diff_backwards_is_none() {
        // Registry shows an older "latest" than what's currently
        // installed — could happen with pinned pre-release or local
        // tarball installs; we treat it as "no update" rather than
        // misclassifying.
        assert_eq!(semver_diff("2.0.0", "1.9.9"), None);
    }

    #[test]
    fn semver_diff_handles_v_prefix_and_prerelease() {
        assert_eq!(semver_diff("v1.0.0", "v1.0.1"), Some(SemverBump::Patch));
        assert_eq!(
            semver_diff("1.0.0-alpha", "1.0.0"),
            // Core versions are identical once the prerelease is stripped —
            // and by SemVer rules 1.0.0 IS newer than 1.0.0-alpha, but we
            // don't try to be that clever here. Documenting the current
            // behaviour so a future upgrade is intentional.
            None
        );
    }

    #[test]
    fn scan_cache_ttl_returns_stale_as_miss() {
        let cache = ScanCache {
            inner: Arc::new(Mutex::new(HashMap::new())),
            ttl: Duration::from_millis(20),
        };
        let cwd = PathBuf::from("/tmp/runhq-overview-test");
        cache.insert(&cwd, None, None);
        assert!(cache.get_fresh(&cwd).is_some());
        std::thread::sleep(Duration::from_millis(40));
        assert!(cache.get_fresh(&cwd).is_none());
    }
}
