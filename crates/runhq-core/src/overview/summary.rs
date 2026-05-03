use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Utc};

use crate::error::AppResult;
use crate::git::{self, GitStatus};
use crate::process::Supervisor;
use crate::resources::ResourceSample;
use crate::scan_history::{PersistedScan, ScanHistoryDb};
use crate::state::Store;

use super::cache::ScanCache;
use super::runtime::detect_runtime;
use super::types::{OverviewSummary, ProjectOverview};

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
    // Drop "workspace-tracking-only" services up-front. They stay in
    // the sidebar (so the user can still open them in an editor or
    // a terminal) but never contribute to the dashboard's roster,
    // headline counts, or aggregate totals — a vendored repo with
    // no `pnpm dev` would otherwise inflate "0 running of 12" to
    // "0 running of 30" and bury the surfaces the user actually
    // cares about.
    let services: Vec<_> = store
        .services()
        .into_iter()
        .filter(|s| !s.hide_dashboard)
        .collect();
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
    let mut total_license_warnings = 0usize;
    let mut projects_with_license_risk = 0usize;
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
        let (mut outdated, mut audit, mut license) = scan_snapshot
            .get(&svc.cwd)
            .map(|e| (e.outdated.clone(), e.audit.clone(), e.license.clone()))
            .unwrap_or((None, None, None));

        // Fall back to the persistent scan history when the in-memory
        // cache doesn't cover this service (the typical cold-start
        // case). We stitch outdated/audit/license independently
        // because some runtimes only persist a subset (e.g. Python
        // has audit but no outdated/license today) — losing all
        // three because one was missing would defeat the whole
        // hydration.
        if outdated.is_none() || audit.is_none() || license.is_none() {
            if let Some(persisted) = persisted_by_id.get(&svc.id) {
                if outdated.is_none() {
                    outdated = persisted.outdated.clone();
                }
                if audit.is_none() {
                    audit = persisted.audit.clone();
                }
                if license.is_none() {
                    license = persisted.license.clone();
                }
            }
        }

        if outdated.is_some() || audit.is_some() || license.is_some() {
            has_dependency_scan = true;
        }
        if let Some(ref o) = outdated {
            total_outdated += o.total;
        }
        if let Some(ref a) = audit {
            total_vulnerabilities += a.critical + a.high + a.medium + a.low;
        }
        if let Some(ref l) = license {
            let warnings = l.contamination_count();
            total_license_warnings += warnings;
            if warnings > 0 {
                projects_with_license_risk += 1;
            }
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
            license,
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
        total_license_warnings,
        projects_with_license_risk,
        stale_count,
        has_dependency_scan,
    })
}
