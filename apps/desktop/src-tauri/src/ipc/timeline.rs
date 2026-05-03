use runhq_core::error::{AppError, AppResult};
use runhq_core::timeline::{self as core_timeline, DailySummary, TimelineEvent, TimelineEventType};
use tauri::State;

use crate::AppState;

// ---- Timeline -------------------------------------------------------------

#[tauri::command]
pub fn record_timeline_event(
    event_type: String,
    service_id: Option<String>,
    service_name: Option<String>,
    description: String,
    run_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("timeline.db");
    let db = core_timeline::TimelineDb::open(&db_path)?;
    let et = match event_type.as_str() {
        "service_started" => TimelineEventType::ServiceStarted,
        "service_stopped" => TimelineEventType::ServiceStopped,
        "service_crashed" => TimelineEventType::ServiceCrashed,
        "git_commit" => TimelineEventType::GitCommit,
        "git_push" => TimelineEventType::GitPush,
        "git_pull" => TimelineEventType::GitPull,
        "git_checkout" => TimelineEventType::GitCheckout,
        "git_branch_created" => TimelineEventType::GitBranchCreated,
        "git_stash" => TimelineEventType::GitStash,
        "log_error" => TimelineEventType::LogError,
        "log_warning" => TimelineEventType::LogWarning,
        "file_changed" => TimelineEventType::FileChanged,
        _ => TimelineEventType::LogError,
    };
    db.record(
        et,
        service_id.as_deref(),
        service_name.as_deref(),
        &description,
        run_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_timeline(
    service_id: Option<String>,
    event_type: Option<String>,
    since_ms: Option<i64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<TimelineEvent>> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("timeline.db");
    let db = core_timeline::TimelineDb::open(&db_path)?;
    let et = event_type.and_then(|s| match s.as_str() {
        "service_started" => Some(TimelineEventType::ServiceStarted),
        "service_stopped" => Some(TimelineEventType::ServiceStopped),
        "service_crashed" => Some(TimelineEventType::ServiceCrashed),
        "git_commit" => Some(TimelineEventType::GitCommit),
        "git_push" => Some(TimelineEventType::GitPush),
        "git_pull" => Some(TimelineEventType::GitPull),
        "git_checkout" => Some(TimelineEventType::GitCheckout),
        "git_branch_created" => Some(TimelineEventType::GitBranchCreated),
        "git_stash" => Some(TimelineEventType::GitStash),
        "log_error" => Some(TimelineEventType::LogError),
        "log_warning" => Some(TimelineEventType::LogWarning),
        "file_changed" => Some(TimelineEventType::FileChanged),
        _ => None,
    });
    let lim = limit.unwrap_or(100).min(10_000);
    db.get_timeline(service_id.as_deref(), et, since_ms, lim)
}

#[tauri::command]
pub fn get_daily_summary(date: String, state: State<'_, AppState>) -> AppResult<DailySummary> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("timeline.db");
    let db = core_timeline::TimelineDb::open(&db_path)?;
    let d = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| AppError::Invalid(format!("invalid date: {e}")))?;
    db.get_daily_summary(d)
}

#[tauri::command]
pub fn get_weekly_summary(
    date: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<DailySummary>> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("timeline.db");
    let db = core_timeline::TimelineDb::open(&db_path)?;
    let d = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| AppError::Invalid(format!("invalid date: {e}")))?;
    db.get_weekly_summary(d)
}

#[tauri::command]
pub fn export_standup(since_ms: i64, state: State<'_, AppState>) -> AppResult<String> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("timeline.db");
    let db = core_timeline::TimelineDb::open(&db_path)?;
    db.export_standup(since_ms)
}
