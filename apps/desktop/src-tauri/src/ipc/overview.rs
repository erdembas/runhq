use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};
use runhq_core::overview::{
    self as core_overview, DependencyScanEntry, DependencyScanResult, OverviewSummary,
};
use runhq_core::scan_history::{PersistedScan, ScanHistoryDb};
use tauri::State;

use crate::AppState;

// ---- Overview -------------------------------------------------------------

/// Resolve the on-disk location for the persistent scan history DB.
/// Co-located with `conversations.db` and `timeline.db` so a future
/// "wipe my data" affordance can rm a single directory.
fn scan_history_db_path(state: &State<'_, AppState>) -> PathBuf {
    state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("dependency_scans.db")
}

pub(super) fn open_scan_history_db(state: &State<'_, AppState>) -> AppResult<ScanHistoryDb> {
    ScanHistoryDb::open(&scan_history_db_path(state))
}

#[tauri::command]
pub async fn get_project_overview(
    stale_threshold_days: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<OverviewSummary> {
    let threshold = stale_threshold_days.unwrap_or(30);
    let db_path = scan_history_db_path(&state);
    // The overview hydrates its outdated/audit chips from the persistent
    // scan history when in-memory cache is empty (cold start, post-
    // restart). Without this path the dashboard would render blank
    // chips for ~30s after every launch.
    core_overview::gather_overview_with_history(
        &state.store,
        &state.supervisor,
        threshold,
        Some(&db_path),
    )
    .await
}

/// Run the heavy per-project dependency/audit scans. Separated from
/// [`get_project_overview`] so the dashboard opens instantly and the user
/// can opt in to the expensive work with a button.
#[tauri::command]
pub async fn scan_project_dependencies(
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<DependencyScanResult> {
    let db_path = scan_history_db_path(&state);
    core_overview::gather_dependency_scan_with_history(
        &state.store,
        force.unwrap_or(false),
        Some(&db_path),
    )
    .await
}

/// Single-project rescan. Lets the dashboard offer a per-card
/// "Rescan this" affordance without forcing a full-workspace sweep —
/// crucial on workspaces with 20+ services where the user just wants
/// to verify one project's freshly-installed dependencies.
///
/// Returns `Err(AppError::NotFound)` when the supplied `service_id`
/// doesn't exist; the frontend can show a "service was removed
/// elsewhere" message rather than silently swallowing the click.
#[tauri::command]
pub async fn scan_project_dependency_for_service(
    service_id: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<DependencyScanEntry> {
    let db_path = scan_history_db_path(&state);
    let entry = core_overview::gather_dependency_scan_for_service(
        &state.store,
        &service_id,
        force.unwrap_or(true),
        Some(&db_path),
    )
    .await?;

    entry.ok_or_else(|| AppError::Other(format!("service not found: {service_id}")))
}

/// Return every persisted dependency-scan row, newest first. The
/// dashboard calls this on mount to seed per-project freshness chips
/// ("Last scanned 3h ago") even before any new scan has run, and again
/// after each scan so the freshness clock resets in place.
#[tauri::command]
pub async fn list_persisted_scans(state: State<'_, AppState>) -> AppResult<Vec<PersistedScan>> {
    let db = open_scan_history_db(&state)?;
    db.list_all()
}

/// Drop the cached scan row for one project. Used by the per-project
/// "Clear cached scan" affordance — handy when the user has swapped
/// the registry under a project and wants stale advisory chips gone
/// without having to wait for a full rescan.
#[tauri::command]
pub async fn delete_persisted_scan(
    service_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_scan_history_db(&state)?;
    db.delete_by_service(&service_id)
}

/// Wipe every persisted scan row. Returns the number of rows that were
/// dropped so the UI can show a confirmation toast.
#[tauri::command]
pub async fn clear_persisted_scans(state: State<'_, AppState>) -> AppResult<usize> {
    let db = open_scan_history_db(&state)?;
    db.clear_all()
}
