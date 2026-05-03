use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use tokio::task::JoinSet;

use crate::error::AppResult;
use crate::scan_history::{PersistedScan, ScanHistoryDb};
use crate::state::Store;

use super::cache::ScanCache;
use super::checks::{run_audit, run_license, run_outdated};
use super::runtime::detect_runtime;
use super::time::{ms_from_instant, now_ms};
use super::types::{DependencyScanEntry, DependencyScanResult};

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
    // Mirror `gather_overview_with_history`: hidden services are
    // workspace-tracking-only, so the batch dependency scan must
    // skip them too. Otherwise the user would still pay 20–30s of
    // `npm outdated` / `cargo audit` per hidden repo on every
    // "Scan dependencies" click — and the totals it returns
    // wouldn't even be rendered, since the dashboard already
    // filtered the projects out. The single-service variant
    // (`gather_dependency_scan_for_service`) intentionally does
    // NOT apply this filter — a per-card "rescan this project"
    // affordance is the one place hidden projects can still get a
    // fresh scan if the user wants it.
    let services: Vec<_> = store
        .services()
        .into_iter()
        .filter(|s| !s.hide_dashboard)
        .collect();
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
                        license: entry.license,
                        scanned_at_ms,
                        duration_ms: None,
                        from_cache: true,
                        previous_total_outdated: None,
                        previous_total_vulnerabilities: None,
                        previous_total_license_warnings: None,
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
            let license_fut = run_license(&cwd);
            // Three-way join: dep tools and license walk hit different
            // sources (registry / disk) so they don't contend; running
            // them concurrently keeps the per-service wall time at
            // roughly `max(outdated, audit, license)` instead of the
            // sum.
            let (outdated, audit, license) = tokio::join!(outdated_fut, audit_fut, license_fut);
            let duration_ms = started.elapsed().as_millis() as i64;
            cache.insert(&cwd, outdated.clone(), audit.clone(), license.clone());
            DependencyScanEntry {
                service_id,
                outdated,
                audit,
                license,
                scanned_at_ms: now_ms(),
                duration_ms: Some(duration_ms),
                from_cache: false,
                previous_total_outdated: None,
                previous_total_vulnerabilities: None,
                previous_total_license_warnings: None,
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
    let mut total_license_warnings = 0usize;
    let mut total_strong_copyleft = 0usize;
    let mut total_network_copyleft = 0usize;
    while let Some(res) = tasks.join_next().await {
        let Ok(mut entry) = res else { continue };
        if let Some(ref o) = entry.outdated {
            total_outdated += o.total;
        }
        if let Some(ref a) = entry.audit {
            total_vulnerabilities += a.critical + a.high + a.medium + a.low;
        }
        if let Some(ref l) = entry.license {
            total_license_warnings += l.contamination_count();
            total_strong_copyleft += l.strong_copyleft_count;
            total_network_copyleft += l.network_copyleft_count;
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
                    entry.previous_total_license_warnings = Some(prev.total_license_warnings);
                }

                let entry_total_outdated =
                    entry.outdated.as_ref().map(|o| o.total).unwrap_or(0) as i64;
                let entry_total_vulns = entry
                    .audit
                    .as_ref()
                    .map(|a| a.critical + a.high + a.medium + a.low)
                    .unwrap_or(0) as i64;
                let entry_total_license = entry
                    .license
                    .as_ref()
                    .map(|l| l.contamination_count())
                    .unwrap_or(0) as i64;
                let scan_row = PersistedScan {
                    service_id: entry.service_id.clone(),
                    cwd: cwd.to_string_lossy().to_string(),
                    service_name: name,
                    outdated: entry.outdated.clone(),
                    audit: entry.audit.clone(),
                    license: entry.license.clone(),
                    scanned_at_ms: entry.scanned_at_ms,
                    duration_ms: entry.duration_ms,
                    total_outdated: entry_total_outdated,
                    total_vulnerabilities: entry_total_vulns,
                    total_license_warnings: entry_total_license,
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
        total_license_warnings,
        total_strong_copyleft,
        total_network_copyleft,
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
                license: cached.license,
                scanned_at_ms: ms_from_instant(cached.fetched_at),
                duration_ms: None,
                from_cache: true,
                previous_total_outdated: None,
                previous_total_vulnerabilities: None,
                previous_total_license_warnings: None,
            }));
        }
    }

    let started = Instant::now();
    let outdated_fut = run_outdated(&cwd, runtime.as_deref());
    let audit_fut = run_audit(&cwd, runtime.as_deref());
    let license_fut = run_license(&cwd);
    let (outdated, audit, license) = tokio::join!(outdated_fut, audit_fut, license_fut);
    let duration_ms = started.elapsed().as_millis() as i64;
    scan_cache.insert(&cwd, outdated.clone(), audit.clone(), license.clone());

    let mut entry = DependencyScanEntry {
        service_id: svc_id.clone(),
        outdated: outdated.clone(),
        audit: audit.clone(),
        license: license.clone(),
        scanned_at_ms: now_ms(),
        duration_ms: Some(duration_ms),
        from_cache: false,
        previous_total_outdated: None,
        previous_total_vulnerabilities: None,
        previous_total_license_warnings: None,
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
                entry.previous_total_license_warnings = Some(prev.total_license_warnings);
            }

            let total_outdated = outdated.as_ref().map(|o| o.total).unwrap_or(0) as i64;
            let total_vulns = audit
                .as_ref()
                .map(|a| a.critical + a.high + a.medium + a.low)
                .unwrap_or(0) as i64;
            let total_license = license
                .as_ref()
                .map(|l| l.contamination_count())
                .unwrap_or(0) as i64;
            let scan_row = PersistedScan {
                service_id: svc_id,
                cwd: cwd.to_string_lossy().to_string(),
                service_name: svc_name,
                outdated,
                audit,
                license,
                scanned_at_ms: entry.scanned_at_ms,
                duration_ms: entry.duration_ms,
                total_outdated,
                total_vulnerabilities: total_vulns,
                total_license_warnings: total_license,
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
