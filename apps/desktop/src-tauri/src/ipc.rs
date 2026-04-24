//! Tauri IPC command surface.
//!
//! Every command here is a thin adapter over [`runhq_core`]. Keep it that
//! way — if a command grows complex logic, push the logic into the core crate
//! where it can be unit-tested without Tauri.

use std::path::PathBuf;

use runhq_core::editors::{self, DetectedEditor};
use runhq_core::error::{AppError, AppResult};
use runhq_core::git::{self, CommitSummary, DiffSummary, GitStatus};
use runhq_core::logs::LogLine;
use runhq_core::overview::{self, DependencyScanResult, OverviewSummary};
use runhq_core::paths;
use runhq_core::ports::{self, ListeningPort};
use runhq_core::process::ServiceStatus;
use runhq_core::scanner::{self, ProjectCandidate};
use runhq_core::state::{CommandEntry, Prefs, ServiceDef, StackDef};
use runhq_core::timeline::{self, DailySummary, TimelineEvent, TimelineEventType};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

// ---- App metadata --------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub version: &'static str,
    pub state_dir: PathBuf,
}

#[tauri::command]
pub fn app_info() -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        state_dir: paths::runhq_home().map_err(AppError::from)?,
    })
}

// ---- Service CRUD --------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ServiceInput {
    pub name: String,
    pub cwd: PathBuf,
    #[serde(default)]
    pub cmds: Vec<CommandEntry>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub path_override: Option<String>,
    #[serde(default)]
    pub pre_command: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub open_browser: bool,
    #[serde(default = "default_grace_ms")]
    pub grace_ms: u64,
}

fn default_grace_ms() -> u64 {
    5_000
}

#[tauri::command]
pub fn list_services(state: State<'_, AppState>) -> AppResult<Vec<ServiceDef>> {
    Ok(state.store.services())
}

#[tauri::command]
pub fn add_service(input: ServiceInput, state: State<'_, AppState>) -> AppResult<ServiceDef> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    if input.cmds.is_empty() {
        return Err(AppError::Invalid("at least one command is required".into()));
    }
    if !input.cwd.exists() {
        return Err(AppError::Invalid(format!(
            "cwd does not exist: {}",
            input.cwd.display()
        )));
    }
    let svc = ServiceDef {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        cwd: input.cwd,
        cmds: input.cmds,
        cmd: None,
        args: vec![],
        env: input.env,
        path_override: input.path_override,
        pre_command: input.pre_command,
        port: input.port,
        tags: input.tags,
        auto_start: input.auto_start,
        open_browser: input.open_browser,
        grace_ms: input.grace_ms,
    };
    state
        .store
        .upsert_service(svc.clone())
        .map_err(AppError::from)?;
    Ok(svc)
}

#[tauri::command]
pub fn update_service(service: ServiceDef, state: State<'_, AppState>) -> AppResult<ServiceDef> {
    state
        .store
        .upsert_service(service.clone())
        .map_err(AppError::from)?;
    Ok(service)
}

#[tauri::command]
pub fn remove_service(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.store.remove_service(&id).map_err(AppError::from)
}

// ---- Scanner -------------------------------------------------------------

#[tauri::command]
pub fn scan_directory(path: PathBuf) -> AppResult<Vec<ProjectCandidate>> {
    if !path.is_dir() {
        return Err(AppError::Invalid(format!(
            "not a directory: {}",
            path.display()
        )));
    }
    scanner::scan(&path)
}

#[tauri::command]
pub fn detect_project(path: PathBuf) -> AppResult<Option<ProjectCandidate>> {
    if !path.is_dir() {
        return Ok(None);
    }
    scanner::detect_one(&path)
}

// ---- Process supervisor --------------------------------------------------

#[tauri::command]
pub async fn start_service(id: String, state: State<'_, AppState>) -> AppResult<ServiceStatus> {
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    state.supervisor.start_all(svc).await
}

#[tauri::command]
pub async fn start_service_cmd(
    id: String,
    cmd_name: String,
    state: State<'_, AppState>,
) -> AppResult<ServiceStatus> {
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    state.supervisor.start_cmd(svc, &cmd_name).await?;
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    Ok(state.supervisor.service_status(&svc))
}

#[tauri::command]
pub fn stop_service(id: String, state: State<'_, AppState>) -> AppResult<ServiceStatus> {
    state.supervisor.stop_all(&id)?;
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    Ok(state.supervisor.service_status(&svc))
}

#[tauri::command]
pub fn stop_service_cmd(
    id: String,
    cmd_name: String,
    state: State<'_, AppState>,
) -> AppResult<ServiceStatus> {
    state.supervisor.stop_cmd(&id, &cmd_name)?;
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    Ok(state.supervisor.service_status(&svc))
}

#[tauri::command]
pub async fn restart_service(id: String, state: State<'_, AppState>) -> AppResult<ServiceStatus> {
    let _ = state.supervisor.stop_all(&id);
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    let svc = state
        .store
        .service(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    state.supervisor.start_all(svc).await
}

#[tauri::command]
pub fn service_status(id: String, state: State<'_, AppState>) -> AppResult<ServiceStatus> {
    let svc = state.store.service(&id).ok_or(AppError::NotFound(id))?;
    Ok(state.supervisor.service_status(&svc))
}

// ---- Logs ----------------------------------------------------------------

#[tauri::command]
pub fn get_logs(
    id: String,
    since_seq: Option<u64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<LogLine>> {
    let since = since_seq.unwrap_or(0);
    let limit = limit.unwrap_or(2_000).min(10_000);
    Ok(if since == 0 {
        state.supervisor.logs.snapshot(&id)
    } else {
        state.supervisor.logs.tail(&id, since, limit)
    })
}

#[tauri::command]
pub fn clear_logs(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.supervisor.logs.clear(&id);
    Ok(())
}

// ---- Ports ---------------------------------------------------------------

#[tauri::command]
pub fn list_ports() -> AppResult<Vec<ListeningPort>> {
    ports::list()
}

#[tauri::command]
pub fn kill_port(port: u16) -> AppResult<Vec<u32>> {
    ports::kill_port(port)
}

// ---- Misc ----------------------------------------------------------------

#[tauri::command]
pub fn open_path(path: PathBuf) -> AppResult<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        open::that(&url).map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

// ---- Preferences ---------------------------------------------------------

#[tauri::command]
pub fn get_prefs(state: State<'_, AppState>) -> AppResult<Prefs> {
    Ok(state.store.snapshot().prefs)
}

#[tauri::command]
pub fn update_prefs(prefs: Prefs, state: State<'_, AppState>) -> AppResult<Prefs> {
    state
        .store
        .update_prefs(|existing| *existing = prefs.clone())
        .map_err(AppError::from)?;
    Ok(prefs)
}

// ---- Editors -------------------------------------------------------------

#[tauri::command]
pub async fn detect_editors() -> AppResult<Vec<DetectedEditor>> {
    Ok(editors::detect_editors().await)
}

#[tauri::command]
pub async fn open_in_editor(command: String, path: PathBuf) -> AppResult<()> {
    editors::open_in_editor(&command, &path).await
}

// ---- Stacks --------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct StackInput {
    pub name: String,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct StackStatus {
    pub id: String,
    pub running: u32,
    pub total: u32,
}

#[tauri::command]
pub fn list_stacks(state: State<'_, AppState>) -> AppResult<Vec<StackDef>> {
    Ok(state.store.stacks())
}

#[tauri::command]
pub fn add_stack(input: StackInput, state: State<'_, AppState>) -> AppResult<StackDef> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    if input.service_ids.is_empty() {
        return Err(AppError::Invalid("at least one service is required".into()));
    }
    let stack = StackDef {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        service_ids: input.service_ids,
        auto_start: input.auto_start,
    };
    state
        .store
        .upsert_stack(stack.clone())
        .map_err(AppError::from)?;
    Ok(stack)
}

#[tauri::command]
pub fn update_stack(stack: StackDef, state: State<'_, AppState>) -> AppResult<StackDef> {
    state
        .store
        .upsert_stack(stack.clone())
        .map_err(AppError::from)?;
    Ok(stack)
}

#[tauri::command]
pub fn remove_stack(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.store.remove_stack(&id).map_err(AppError::from)
}

#[tauri::command]
pub async fn start_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let total = stack.service_ids.len() as u32;
    let mut running: u32 = 0;
    for sid in &stack.service_ids {
        if let Some(svc) = state.store.service(sid) {
            let _ = state.supervisor.start_all(svc.clone()).await;
            if let Some(port) = svc.port {
                runhq_core::ports::wait_for_port(port, std::time::Duration::from_secs(30)).await;
            }
        }
    }
    for sid in &stack.service_ids {
        if state.supervisor.is_running(sid) {
            running += 1;
        }
    }
    Ok(StackStatus {
        id: stack.id,
        running,
        total,
    })
}

#[tauri::command]
pub fn stop_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let total = stack.service_ids.len() as u32;
    for sid in &stack.service_ids {
        let _ = state.supervisor.stop_all(sid);
    }
    Ok(StackStatus {
        id: stack.id,
        running: 0,
        total,
    })
}

// ---- Overview -------------------------------------------------------------

#[tauri::command]
pub async fn get_project_overview(
    stale_threshold_days: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<OverviewSummary> {
    let threshold = stale_threshold_days.unwrap_or(30);
    overview::gather_overview(&state.store, &state.supervisor, threshold).await
}

/// Run the heavy per-project dependency/audit scans. Separated from
/// [`get_project_overview`] so the dashboard opens instantly and the user
/// can opt in to the expensive work with a button.
#[tauri::command]
pub async fn scan_project_dependencies(
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<DependencyScanResult> {
    overview::gather_dependency_scan(&state.store, force.unwrap_or(false)).await
}

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
    let db = timeline::TimelineDb::open(&db_path)?;
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
    let db = timeline::TimelineDb::open(&db_path)?;
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
    let db = timeline::TimelineDb::open(&db_path)?;
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
    let db = timeline::TimelineDb::open(&db_path)?;
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
    let db = timeline::TimelineDb::open(&db_path)?;
    db.export_standup(since_ms)
}

// ---- Git -----------------------------------------------------------------

fn resolve_cwd(id: &str, state: &State<'_, AppState>) -> AppResult<PathBuf> {
    state
        .store
        .service(id)
        .map(|s| s.cwd)
        .ok_or_else(|| AppError::NotFound(id.to_string()))
}

// ---- Git Diff -------------------------------------------------------------

#[tauri::command]
pub fn git_diff(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff(&cwd)
}

#[tauri::command]
pub fn git_diff_staged(id: String, state: State<'_, AppState>) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_staged(&cwd)
}

#[tauri::command]
pub fn git_diff_file(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_file(&cwd, &file, context)
}

#[tauri::command]
pub fn git_diff_file_staged(
    id: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_file_staged(&cwd, &file, context)
}

#[tauri::command]
pub fn git_diff_branches(
    id: String,
    base: String,
    head: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_branches(&cwd, &base, &head)
}

#[tauri::command]
pub fn git_diff_all_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_all_raw(&cwd)
}

#[tauri::command]
pub fn git_diff_staged_raw(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_staged_raw(&cwd)
}

#[tauri::command]
pub fn git_status(id: String, state: State<'_, AppState>) -> AppResult<Option<GitStatus>> {
    let cwd = resolve_cwd(&id, &state)?;
    Ok(git::status(&cwd))
}

#[tauri::command]
pub fn git_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    git::list_branches(&cwd)
}

#[tauri::command]
pub fn git_remote_branches(id: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let cwd = resolve_cwd(&id, &state)?;
    git::list_remote_branches(&cwd)
}

#[tauri::command]
pub fn git_checkout(id: String, branch: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::checkout(&cwd, &branch)
}

#[tauri::command]
pub fn git_create_branch(id: String, name: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::create_branch(&cwd, &name)
}

#[tauri::command]
pub fn git_delete_branch(
    id: String,
    name: String,
    force: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::delete_branch(&cwd, &name, force)
}

#[tauri::command]
pub async fn git_fetch(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || git::fetch(&cwd))
        .await
        .map_err(|e| AppError::Other(format!("fetch task join failed: {e}")))?
}

#[tauri::command]
pub async fn git_pull(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || git::pull(&cwd))
        .await
        .map_err(|e| AppError::Other(format!("pull task join failed: {e}")))?
}

#[tauri::command]
pub fn git_stash(id: String, message: Option<String>, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::stash(&cwd, message.as_deref())
}

#[tauri::command]
pub fn git_stash_pop(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::stash_pop(&cwd)
}

#[tauri::command]
pub fn git_undo_last_commit(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::undo_last_commit(&cwd)
}

#[tauri::command]
pub fn git_amend_commit_message(
    id: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::amend_commit_message(&cwd, &message)
}

#[tauri::command]
pub fn git_stage_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::stage_file(&cwd, &path)
}

#[tauri::command]
pub fn git_unstage_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::unstage_file(&cwd, &path)
}

#[tauri::command]
pub fn git_stage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::stage_all(&cwd)
}

#[tauri::command]
pub fn git_unstage_all(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::unstage_all(&cwd)
}

#[tauri::command]
pub fn git_discard_file(id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::discard_file(&cwd, &path)
}

#[tauri::command]
pub fn git_commit(
    id: String,
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    git::commit(&cwd, &message, amend)
}

#[tauri::command]
pub async fn git_push(
    id: String,
    force_with_lease: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = resolve_cwd(&id, &state)?;
    tokio::task::spawn_blocking(move || git::push(&cwd, force_with_lease))
        .await
        .map_err(|e| AppError::Other(format!("push task join failed: {e}")))?
}

#[tauri::command]
pub fn git_log(
    id: String,
    branch: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitSummary>> {
    let cwd = resolve_cwd(&id, &state)?;
    git::log(&cwd, branch.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn git_show_commit(
    id: String,
    hash: String,
    state: State<'_, AppState>,
) -> AppResult<DiffSummary> {
    let cwd = resolve_cwd(&id, &state)?;
    git::show_commit(&cwd, &hash)
}

#[tauri::command]
pub fn git_diff_commit_file(
    id: String,
    hash: String,
    file: String,
    context: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    git::diff_commit_file(&cwd, &hash, &file, context)
}

#[tauri::command]
pub async fn restart_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let total = stack.service_ids.len() as u32;
    for sid in &stack.service_ids {
        let _ = state.supervisor.stop_all(sid);
    }
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    let mut running: u32 = 0;
    for sid in &stack.service_ids {
        if let Some(svc) = state.store.service(sid) {
            let _ = state.supervisor.start_all(svc.clone()).await;
            if let Some(port) = svc.port {
                runhq_core::ports::wait_for_port(port, std::time::Duration::from_secs(30)).await;
            }
        }
    }
    for sid in &stack.service_ids {
        if state.supervisor.is_running(sid) {
            running += 1;
        }
    }
    Ok(StackStatus {
        id: stack.id,
        running,
        total,
    })
}
