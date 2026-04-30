//! Tauri IPC command surface.
//!
//! Every command here is a thin adapter over [`runhq_core`]. Keep it that
//! way — if a command grows complex logic, push the logic into the core crate
//! where it can be unit-tested without Tauri.

use std::path::PathBuf;

use runhq_core::ai::{
    self, AiProvider, AiProviderKind, ChatMessage, ChatOptions, ChatResponse, StreamChunk,
    TestResult,
};
use runhq_core::conversations::{
    self, AppendMessageInput, Conversation, ConversationSummary, ConversationsDb,
    CreateConversationInput,
};
use runhq_core::docs::{self, DocContent, ProjectDoc};
use runhq_core::editors::{self, DetectedEditor};
use runhq_core::error::{AppError, AppResult};
use runhq_core::git::{self, CommitSummary, DiffSummary, GitStatus};
use runhq_core::license::{self, LicenseScanResult};
use runhq_core::logs::LogLine;
use runhq_core::notes;
use runhq_core::overview::{self, DependencyScanEntry, DependencyScanResult, OverviewSummary};
use runhq_core::paths;
use runhq_core::ports::{self, ListeningPort};
use runhq_core::process::ServiceStatus;
use runhq_core::scan_history::{PersistedScan, ScanHistoryDb};
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
    let removed = state.store.remove_service(&id).map_err(AppError::from)?;
    // Best-effort cleanup of the persisted dependency-scan row for
    // this service. Without this an orphaned row would linger
    // forever, occasionally getting "rehydrated" into the dashboard
    // for a service that no longer exists. We deliberately don't
    // surface DB errors here — the user-visible action ("removed") has
    // already succeeded; dropping the cached scan is a hygiene step,
    // not part of the contract.
    if removed {
        if let Ok(db) = open_scan_history_db(&state) {
            if let Err(e) = db.delete_by_service(&id) {
                tracing::warn!(service_id = %id, "scan history cleanup on remove failed: {e}");
            }
        }
        // Drop the project-notes directory too. We don't want a
        // stale note file (or directory of notes, post-v0.10) to
        // silently rehydrate when a freshly-added service happens
        // to be assigned the same UUID (extremely unlikely with v4
        // UUIDs, but the cost of cleanup is zero).
        if let Err(e) = runhq_core::notes::delete_all_notes(&id) {
            tracing::warn!(service_id = %id, "notes cleanup on remove failed: {e}");
        }
    }
    Ok(removed)
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

fn open_scan_history_db(state: &State<'_, AppState>) -> AppResult<ScanHistoryDb> {
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
    overview::gather_overview_with_history(
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
    overview::gather_dependency_scan_with_history(
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
    let entry = overview::gather_dependency_scan_for_service(
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

// ---- Conversations (AI chat history) -------------------------------------

fn open_conversations_db(state: &State<'_, AppState>) -> AppResult<ConversationsDb> {
    let db_path = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("conversations.db");
    ConversationsDb::open(&db_path)
}

#[derive(Debug, Deserialize)]
pub struct ListConversationsInput {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub include_archived: bool,
    /// When true, restrict the result set to favorited conversations.
    /// Honoured independently from `include_archived` so the user can
    /// browse "favorites + archived" without losing either filter.
    #[serde(default)]
    pub favorites_only: bool,
    /// Optional substring search across title and message content.
    /// Empty/whitespace strings are treated as "no filter".
    #[serde(default)]
    pub query: Option<String>,
}

#[tauri::command]
pub fn list_conversations(
    input: ListConversationsInput,
    state: State<'_, AppState>,
) -> AppResult<Vec<ConversationSummary>> {
    let db = open_conversations_db(&state)?;
    let lim = input.limit.unwrap_or(200).min(2000);
    db.list_conversations(
        lim,
        input.include_archived,
        input.favorites_only,
        input.query.as_deref(),
    )
}

#[tauri::command]
pub fn get_conversation(id: String, state: State<'_, AppState>) -> AppResult<Conversation> {
    let db = open_conversations_db(&state)?;
    db.get_conversation(&id)
}

#[tauri::command]
pub fn create_conversation(
    input: CreateConversationInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = open_conversations_db(&state)?;
    db.create_conversation(input)
}

#[tauri::command]
pub fn append_conversation_message(
    input: AppendMessageInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = open_conversations_db(&state)?;
    db.append_message(input)
}

#[derive(Debug, Deserialize)]
pub struct RenameConversationInput {
    pub id: String,
    pub title: String,
}

#[tauri::command]
pub fn rename_conversation(
    input: RenameConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.rename_conversation(&input.id, &input.title)
}

#[derive(Debug, Deserialize)]
pub struct PinConversationInput {
    pub id: String,
    pub pinned: bool,
}

#[tauri::command]
pub fn pin_conversation(input: PinConversationInput, state: State<'_, AppState>) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.pin_conversation(&input.id, input.pinned)
}

#[derive(Debug, Deserialize)]
pub struct FavoriteConversationInput {
    pub id: String,
    pub favorite: bool,
}

#[tauri::command]
pub fn favorite_conversation(
    input: FavoriteConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.favorite_conversation(&input.id, input.favorite)
}

#[derive(Debug, Deserialize)]
pub struct ArchiveConversationInput {
    pub id: String,
    pub archived: bool,
}

#[tauri::command]
pub fn archive_conversation(
    input: ArchiveConversationInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.archive_conversation(&input.id, input.archived)
}

#[tauri::command]
pub fn delete_conversation(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let db = open_conversations_db(&state)?;
    db.delete_conversation(&id)
}

// Force module-use so the unused-import lint stays happy when the
// module exports types we re-export but don't directly call inside ipc.
#[allow(dead_code)]
fn _conversations_module_link() {
    let _ = std::any::type_name::<conversations::Message>();
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

// ---- AI providers --------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AiProviderInput {
    /// When omitted we mint a new id; passing one updates the existing
    /// record. Lets the React form reuse the same endpoint for create
    /// and edit without juggling separate IPC routes.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub kind: AiProviderKind,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub default: bool,
    /// Preferred response language as a BCP-47-ish code (`en`, `tr`,
    /// `auto`, …). Optional — when absent the model decides on its
    /// own (typically English or whatever the user wrote in).
    #[serde(default)]
    pub response_language: Option<String>,
    /// Per-provider language override for AI-generated commit
    /// messages. Optional. Empty / `inherit` means "use
    /// response_language"; `auto` opts the commit surface out of any
    /// language directive even when the chat surface has one. See
    /// `AiProvider::commit_language_directive`.
    #[serde(default)]
    pub commit_language: Option<String>,
    /// Per-provider hard ceiling on output tokens. `None` means "no
    /// client-side cap" — let the server decide. The form treats an
    /// empty input as `None`; a positive integer is forwarded as-is
    /// and clamps every AI surface (chat, diff, log, standup,
    /// project, commit message). See `AiProvider::max_output_tokens`
    /// for the resolution rules.
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    /// Optional context window (input + output) in tokens. Drives the
    /// chat composer's TokenMeter. 0/None means "no denominator" —
    /// the meter still shows the raw count.
    #[serde(default)]
    pub context_window: Option<u32>,
}

#[tauri::command]
pub fn list_ai_providers(state: State<'_, AppState>) -> AppResult<Vec<AiProvider>> {
    Ok(state.store.ai_providers())
}

#[tauri::command]
pub fn upsert_ai_provider(
    input: AiProviderInput,
    state: State<'_, AppState>,
) -> AppResult<AiProvider> {
    if input.name.trim().is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    if input.base_url.trim().is_empty() {
        return Err(AppError::Invalid("base URL is required".into()));
    }
    if input.model.trim().is_empty() {
        return Err(AppError::Invalid("model is required".into()));
    }

    // Preserve the original `created_at_ms` on edits — purely cosmetic
    // ("added 3 days ago") but a stable timestamp keeps the list order
    // honest after every save.
    let (id, created_at_ms) = match input.id.as_deref() {
        Some(id) if !id.is_empty() => {
            let existing_ts = state
                .store
                .ai_provider(id)
                .map(|p| p.created_at_ms)
                .unwrap_or_else(now_ms);
            (id.to_string(), existing_ts)
        }
        _ => (uuid::Uuid::new_v4().to_string(), now_ms()),
    };

    let provider = AiProvider {
        id,
        name: input.name.trim().to_string(),
        kind: input.kind,
        base_url: input.base_url.trim().to_string(),
        api_key: input.api_key,
        model: input.model.trim().to_string(),
        default: input.default,
        response_language: input
            .response_language
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        commit_language: input
            .commit_language
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        // 0 from the form means "blank → no cap", same as `None`. Any
        // positive value is forwarded as-is. We don't clamp to a
        // minimum here: if the user types `1` they get `1`, and the
        // resulting truncated answer is its own teaching moment.
        max_output_tokens: input.max_output_tokens.filter(|v| *v > 0),
        context_window: input.context_window.filter(|v| *v > 0),
        created_at_ms,
    };
    state
        .store
        .upsert_ai_provider(provider.clone())
        .map_err(AppError::from)?;
    Ok(provider)
}

#[tauri::command]
pub fn remove_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.store.remove_ai_provider(&id).map_err(AppError::from)
}

#[tauri::command]
pub fn set_default_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state
        .store
        .set_default_ai_provider(&id)
        .map_err(AppError::from)
}

/// Probe the provider's `/chat/completions` endpoint without burning
/// real tokens. Returns a structured success/failure record so the UI
/// can render a green check + latency or a red error message without
/// having to parse exception strings.
#[tauri::command]
pub async fn test_ai_provider(id: String, state: State<'_, AppState>) -> AppResult<TestResult> {
    let provider = state.store.ai_provider(&id).ok_or(AppError::NotFound(id))?;
    ai::test_provider(&provider).await
}

#[derive(Debug, Deserialize)]
pub struct ChatRequestInput {
    /// When `None`, we resolve the user's default provider. Lets feature
    /// surfaces (commit panel, future inline chat, etc.) call this
    /// without each one re-implementing default-resolution.
    #[serde(default)]
    pub provider_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub options: ChatOptions,
}

#[tauri::command]
pub async fn ai_chat_completion(
    input: ChatRequestInput,
    state: State<'_, AppState>,
) -> AppResult<ChatResponse> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    ai::chat_completion(&provider, input.messages, input.options).await
}

/// Snapshot of the data needed to seed a commit-message chat in the
/// AI Chat panel. The Phase-5 chat-hub flow asks the renderer to drive
/// the conversation (so the user can switch models, follow up, etc.),
/// but git plumbing is still cheapest in Rust — we run the diff and
/// log here, hand the plain text to JS, and let the panel build its
/// own prompt around it.
///
/// Why not just return the prompt strings?
/// We could, but that hard-codes the prompt structure on the Rust
/// side. By shipping the raw evidence the renderer can iterate on
/// wording / persona without an IPC version bump.
#[derive(Debug, Serialize)]
pub struct CommitChatContext {
    pub branch: Option<String>,
    pub diff: String,
    pub recent_subjects: Vec<String>,
    /// Truncation marker so the renderer can show a "[diff truncated]"
    /// pill or similar without re-implementing the size policy. Set
    /// when we cap the staged diff at `MAX_COMMIT_CHAT_DIFF_CHARS`.
    pub diff_truncated: bool,
}

#[derive(Debug, Deserialize)]
pub struct CommitChatContextInput {
    pub service_id: String,
}

/// Soft cap for the staged-diff blob shipped to the chat panel. Big
/// enough to capture a meaty refactor (~250 lines), small enough that
/// even tiny-context models won't choke when we tack on the system
/// prompt + recent commits.
const MAX_COMMIT_CHAT_DIFF_CHARS: usize = 12_000;

#[tauri::command]
pub async fn ai_commit_chat_context(
    input: CommitChatContextInput,
    state: State<'_, AppState>,
) -> AppResult<CommitChatContext> {
    let cwd = resolve_cwd(&input.service_id, &state)?;

    let cwd_for_diff = cwd.clone();
    let mut diff = tokio::task::spawn_blocking(move || git::diff_staged_raw(&cwd_for_diff))
        .await
        .map_err(|e| AppError::Other(format!("diff task join failed: {e}")))??;
    let mut diff_truncated = false;
    if diff.len() > MAX_COMMIT_CHAT_DIFF_CHARS {
        diff.truncate(MAX_COMMIT_CHAT_DIFF_CHARS);
        diff.push_str("\n[diff truncated by RunHQ — only the leading hunks were sent]");
        diff_truncated = true;
    }

    let cwd_for_log = cwd.clone();
    let recent = tokio::task::spawn_blocking(move || git::log(&cwd_for_log, None, 8))
        .await
        .map_err(|e| AppError::Other(format!("log task join failed: {e}")))?
        .unwrap_or_default();
    let recent_subjects: Vec<String> = recent.into_iter().map(|c| c.subject).collect();

    let branch = git::status(&cwd).and_then(|s| s.branch);

    Ok(CommitChatContext {
        branch,
        diff,
        recent_subjects,
        diff_truncated,
    })
}

#[derive(Debug, Deserialize)]
pub struct GenerateCommitInput {
    /// Service whose working tree we summarise. Service id (rather than
    /// raw cwd) keeps the surface uniform with every other git command.
    pub service_id: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Optional one-line nudge from the user ("focus on the perf fix")
    /// — the AI gives it weight when picking which area of the diff
    /// to emphasise.
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GenerateCommitResult {
    pub message: String,
    pub model: Option<String>,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub provider_id: String,
    pub provider_name: String,
}

#[tauri::command]
pub async fn ai_generate_commit_message(
    input: GenerateCommitInput,
    state: State<'_, AppState>,
) -> AppResult<GenerateCommitResult> {
    let cwd = resolve_cwd(&input.service_id, &state)?;
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;

    // Pull tone-matching context off the main thread — git shells out,
    // so even quick reads block briefly. Wrapping in `spawn_blocking`
    // is cheap insurance against ever-so-slightly-slow filesystems.
    let cwd_for_diff = cwd.clone();
    let diff = tokio::task::spawn_blocking(move || git::diff_staged_raw(&cwd_for_diff))
        .await
        .map_err(|e| AppError::Other(format!("diff task join failed: {e}")))??;

    let cwd_for_log = cwd.clone();
    let recent = tokio::task::spawn_blocking(move || git::log(&cwd_for_log, None, 8))
        .await
        .map_err(|e| AppError::Other(format!("log task join failed: {e}")))?
        .unwrap_or_default();
    let recent_subjects: Vec<String> = recent.into_iter().map(|c| c.subject).collect();

    let branch = git::status(&cwd).and_then(|s| s.branch);

    let raw = ai::generate_commit_message(
        &provider,
        &diff,
        branch.as_deref(),
        &recent_subjects,
        input.hint.as_deref(),
    )
    .await?;

    Ok(GenerateCommitResult {
        message: raw,
        // We don't have a token count here because `generate_commit_message`
        // discards the raw `ChatResponse`. Keeping the fields in the IPC
        // shape (rather than dropping them) lets us start surfacing
        // "Used N tokens" in the UI later without an IPC version bump.
        model: Some(provider.model.clone()),
        prompt_tokens: None,
        completion_tokens: None,
        provider_id: provider.id.clone(),
        provider_name: provider.name.clone(),
    })
}

// ---- AI streaming surfaces -----------------------------------------------

/// Generic chat completion with streaming. The frontend hooks a
/// `Channel<StreamChunk>` and renders deltas as they arrive — matches
/// the OpenAI streaming experience users already know.
#[tauri::command]
pub async fn ai_chat_completion_stream(
    input: ChatRequestInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    stream_with_fallback(&provider, input.messages, input.options, on_chunk).await
}

#[derive(Debug, Deserialize)]
pub struct ExplainDiffInput {
    /// Unified diff text. The frontend ships it raw so the backend
    /// doesn't have to know which surface (commit panel, history,
    /// branches, cross-project) the diff came from.
    pub diff: String,
    #[serde(default)]
    pub file_path: Option<String>,
    /// `true` when the diff represents a hand-picked selection
    /// (single hunk) rather than a whole file. Adjusts the prompt
    /// wording so the model knows the scope is narrow.
    #[serde(default)]
    pub selection_only: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_diff(
    input: ExplainDiffInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.diff.trim().is_empty() {
        return Err(AppError::Invalid(
            "There is no diff to explain — stage or open a change first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_explain_diff_prompt(
        &input.diff,
        input.file_path.as_deref(),
        input.selection_only,
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // A tad warmer than commit messages: explanations benefit
            // from one or two paraphrasing attempts when the user
            // hits "regenerate".
            temperature: Some(0.3),
            // No surface-level cap. Diff explanation is the surface
            // most likely to need a *lot* of room — a power user on
            // a Gemini 1M / Claude 200K model might paste 800 commits
            // of history and expect a multi-section walk-through. A
            // hard 1500 here would silently truncate that. We trust
            // the provider's `max_output_tokens` (configured in AI
            // Settings) or the server's own per-model default to be
            // the safety net. The `<think>` parser and scratchpad
            // reclassifier already hide planning preambles from the
            // UI, so giving the model unlimited rope only costs the
            // user's own latency / quota — their call to make.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ExplainLogInput {
    /// The single log line the user right-clicked on.
    pub line: String,
    /// The surrounding ±N lines. Order is preserved (oldest first);
    /// the prompt frames it as "most-recent last" to match how
    /// engineers read tail output.
    #[serde(default)]
    pub context_lines: Vec<String>,
    /// Inferred runtime hint ("node", "rust", "go", "python", …).
    /// Drives ecosystem-aware suggestions in the model's reply.
    #[serde(default)]
    pub runtime: Option<String>,
    /// User-friendly service name (`api-svc`), used so the model can
    /// speak about the failure in concrete terms.
    #[serde(default)]
    pub service_name: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_log(
    input: ExplainLogInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.line.trim().is_empty() {
        return Err(AppError::Invalid("Log line is empty.".into()));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_log_triage_prompt(
        &input.line,
        &input.context_lines,
        input.runtime.as_deref(),
        input.service_name.as_deref(),
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            temperature: Some(0.2),
            // No surface cap. Triage body is naturally short (~250t)
            // because the prompt format constrains it ("Likely cause:
            // … Try this: …"), but we let the provider / server be
            // the ceiling so users on long-context models can paste
            // whole stack traces and get back equally thorough
            // breakdowns. If a local 3B model goes overboard with
            // its planning preamble, the user can either set a
            // provider-level `max_output_tokens` cap or hit Stop.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct TriageAdvisoriesInput {
    /// The (already filtered + ordered) advisory rows the user wants
    /// the model to triage. Frontend ships them through unchanged
    /// from the visible list — that way the model triages exactly
    /// what the user is looking at, even when severity tile filters
    /// have narrowed the view to "CRITICAL only".
    pub advisories: Vec<ai::AdvisoryBrief>,
    /// Friendly project name (e.g. `belgehub-mobile`). Drives the
    /// "Project: `…`" header in the prompt; lets the model speak
    /// about the failure in concrete terms.
    #[serde(default)]
    pub project_name: Option<String>,
    /// Inferred runtime (`node`, `python`, `rust`, …). Adjusts the
    /// model's fix recommendations toward the right ecosystem
    /// (`npm install` vs `pip install` vs `cargo update`).
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_triage_advisories(
    input: TriageAdvisoriesInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.advisories.is_empty() {
        return Err(AppError::Invalid(
            "No advisories to triage — clear filters or run a scan first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_advisory_triage_prompt(
        &input.advisories,
        input.project_name.as_deref(),
        input.runtime.as_deref(),
    );
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Slightly cool — triage benefits from consistent
            // ordering across regenerations more than it does from
            // creative phrasing. Hot temperatures here have shown
            // (in QA) a tendency to swap the top-3 fix order on
            // each regenerate, which destroys the "did it agree
            // with itself?" sanity check the user does mentally.
            temperature: Some(0.2),
            // No surface cap; defer to provider/model. The prompt's
            // self-imposed 300-word limit constrains output even on
            // verbose models, but a 60-row triage with proper
            // grouping rationale legitimately exceeds 1500 tokens
            // on smaller models — past tests with a hard cap here
            // produced mid-list cutoffs that hid the most useful
            // recommendations.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct PolishStandupInput {
    /// Raw markdown produced by `timeline::export_standup`. We
    /// intentionally ship it as a string instead of re-deriving on the
    /// backend so the user gets the same content they're staring at.
    pub raw_markdown: String,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_polish_standup(
    input: PolishStandupInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.raw_markdown.trim().is_empty() {
        return Err(AppError::Invalid(
            "Nothing to polish — record some activity first.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let messages = ai::build_polish_standup_prompt(&input.raw_markdown);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            temperature: Some(0.4),
            // No surface cap. The polished standup itself is bounded
            // by format (~250t of Yesterday / Today / Blockers
            // bullets), but a long week of activity legitimately
            // produces longer standups, and scratchpad-heavy models
            // need uncapped room to think. The provider-level
            // `max_output_tokens` is the place to clamp this if the
            // user is on a small model with a fixed output window.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeWorkspaceInput {
    /// Pre-aggregated portfolio snapshot built by the frontend (see
    /// `lib/ai/workspaceSummary.ts`). We accept it as a free-form
    /// `serde_json::Value` rather than a typed schema so the
    /// dashboard can grow new signal columns (e.g. log-error
    /// counts, dependabot alerts, deployment status) without
    /// dragging the IPC layer along — the prompt is JSON-aware and
    /// the model handles missing keys gracefully.
    #[serde(default)]
    pub facts: serde_json::Value,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_analyze_workspace(
    input: AnalyzeWorkspaceInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.facts.is_null() {
        return Err(AppError::Invalid(
            "Nothing to analyse — workspace snapshot is empty.".into(),
        ));
    }
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let facts_pretty =
        serde_json::to_string_pretty(&input.facts).unwrap_or_else(|_| input.facts.to_string());
    let messages = ai::build_workspace_report_prompt(&facts_pretty);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Cool — the workspace report is a structured executive
            // summary; users regenerate it expecting the same risk
            // picture, only re-phrased. A hot temperature here
            // produces wildly different "top hotspot" rankings on
            // back-to-back runs and erodes trust.
            temperature: Some(0.2),
            // No surface cap. The prompt's 250-word ceiling
            // keeps output bounded; uncapped lets reasoning-heavy
            // models think privately without clipping the visible
            // report.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ExplainProjectInput {
    /// Pre-built one-line summary from the dashboard ("api-svc · 3
    /// critical CVEs · 47d stale · dirty tree"). The frontend builds
    /// it because it has the user's chosen number formatting; the
    /// backend just frames it for the LLM.
    pub headline: String,
    /// Structured facts as a free-form JSON object. Anything the
    /// dashboard already knows about the project: `dirty_files`,
    /// `branch`, `ahead`, `behind`, `cve_critical`, `outdated_total`,
    /// `last_activity_days`, `runtime`, etc. Passing it as JSON
    /// (rather than a typed Rust struct) keeps the IPC stable as the
    /// dashboard adds new dimensions.
    #[serde(default)]
    pub facts: serde_json::Value,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[tauri::command]
pub async fn ai_explain_project_state(
    input: ExplainProjectInput,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let provider = resolve_ai_provider(input.provider_id.as_deref(), &state)?;
    let mut block = String::new();
    if !input.headline.trim().is_empty() {
        block.push_str(&format!("Headline: {}\n\n", input.headline.trim()));
    }
    let facts_pretty =
        serde_json::to_string_pretty(&input.facts).unwrap_or_else(|_| input.facts.to_string());
    block.push_str("Facts:\n```json\n");
    block.push_str(&facts_pretty);
    block.push_str("\n```\n");

    let messages = ai::build_explain_project_prompt(&block);
    stream_with_fallback(
        &provider,
        messages,
        ChatOptions {
            // Dashboard explanation is a hover-popover; we want a
            // calm, factual tone, not creative writing.
            temperature: Some(0.1),
            // No surface cap — defer to provider / server. The
            // popover answer is bounded by the prompt itself ("one
            // tight paragraph") so we don't *need* a numeric ceiling
            // to keep it short, and an uncapped budget gives small
            // models room to plan in private without truncating the
            // visible paragraph that comes after.
            max_tokens: None,
        },
        on_chunk,
    )
    .await
}

/// Run a streaming completion and guarantee that the channel sees
/// exactly one terminal event (`Done` from the core, or an `Error`
/// emitted here when the network/SSE parser bails mid-stream). Without
/// this, a dropped connection would leave the UI spinner stuck forever
/// because no terminal chunk ever arrives.
async fn stream_with_fallback(
    provider: &AiProvider,
    mut messages: Vec<ChatMessage>,
    options: ChatOptions,
    on_chunk: tauri::ipc::Channel<StreamChunk>,
) -> AppResult<()> {
    // Apply the provider's preferred response language uniformly across
    // every streaming surface (chat panel, diff explainer, log triage,
    // standup polisher, project state). Doing it here — rather than in
    // each prompt builder — keeps the builders pure and means a future
    // 6th feature inherits the behaviour for free.
    if let Some(directive) = provider.language_directive() {
        ai::apply_language_to_vec(&mut messages, &directive);
    }
    // Note: we don't merge `options.max_tokens` against
    // `provider.max_output_tokens` here. `chat_completion_stream`
    // calls `provider.resolve_max_tokens(options.max_tokens)` at
    // body-building time and applies the same min-rule that
    // `chat_completion` (non-streaming) uses, so commit-message
    // generation and streaming surfaces honour the user's
    // per-provider cap identically.
    let result = ai::chat_completion_stream(provider, messages, options, |chunk| {
        let _ = on_chunk.send(chunk);
    })
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            // Best-effort terminal Error so the UI can render a
            // failure state instead of an indefinite "thinking…".
            let _ = on_chunk.send(StreamChunk::Error {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

fn resolve_ai_provider(
    explicit_id: Option<&str>,
    state: &State<'_, AppState>,
) -> AppResult<AiProvider> {
    if let Some(id) = explicit_id {
        return state
            .store
            .ai_provider(id)
            .ok_or_else(|| AppError::NotFound(format!("AI provider {id}")));
    }
    state.store.default_ai_provider().ok_or_else(|| {
        AppError::Invalid(
            "No AI provider configured. Open Settings → AI Providers to add one.".into(),
        )
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
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

// ---- Token counting (chat composer meter) -------------------------------

#[derive(Debug, Deserialize)]
pub struct CountTokensInput {
    /// String fragments to count. The frontend passes one entry per
    /// chat history message + the live composer text — summing on
    /// our side avoids materialising a single oversized `String` on
    /// every keystroke.
    pub texts: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CountTokensOutput {
    /// BPE-estimated token total. See `runhq_core::tokens` for the
    /// tokeniser choice and fallback semantics.
    pub tokens: u32,
}

/// Estimate the prompt size in tokens for the chat composer's meter.
///
/// Cheap by tiktoken standards — we use `o200k_base` (GPT-4o family,
/// efficient for non-Latin scripts) and the call is linear in input
/// length. Frontend can call this on every keystroke without
/// debouncing for prompts up to ~50KB; bigger payloads should be
/// debounced at ~100ms by the caller.
#[tauri::command]
pub async fn ai_count_tokens(input: CountTokensInput) -> AppResult<CountTokensOutput> {
    // The tokeniser does its own thread-safe lazy init, so we can
    // call it directly from the async context without spawning to
    // a blocking pool. Empty inputs short-circuit inside `count_tokens`.
    let tokens = runhq_core::tokens::count_tokens_many(&input.texts);
    Ok(CountTokensOutput { tokens })
}

// ---- Per-project Notes ----------------------------------------------------
//
// Multi-note edition. v0.10 expanded the per-service notebook from a
// single `.md` file to a directory of named files; the legacy single-
// file shape auto-migrates on first list/read so old users see no
// behavioural change beyond "now you can have more than one note".

#[tauri::command]
pub fn list_notes(service_id: String) -> AppResult<Vec<runhq_core::notes::NoteFile>> {
    notes::list_notes(&service_id).map_err(AppError::from)
}

#[tauri::command]
pub fn read_note(service_id: String, name: String) -> AppResult<String> {
    notes::read_note(&service_id, &name).map_err(AppError::from)
}

#[tauri::command]
pub fn write_note(service_id: String, name: String, content: String) -> AppResult<()> {
    notes::write_note(&service_id, &name, &content).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_note(service_id: String, name: String) -> AppResult<bool> {
    notes::delete_note(&service_id, &name).map_err(AppError::from)
}

#[tauri::command]
pub fn create_note(service_id: String, requested_name: Option<String>) -> AppResult<String> {
    notes::create_note(&service_id, requested_name.as_deref()).map_err(AppError::from)
}

#[tauri::command]
pub fn read_all_notes(service_id: String) -> AppResult<String> {
    notes::read_all_notes(&service_id).map_err(AppError::from)
}

#[tauri::command]
pub fn list_noted_services() -> AppResult<Vec<String>> {
    notes::list_noted_services().map_err(AppError::from)
}

// ---- Project DOCS ---------------------------------------------------------
//
// Backed by `runhq_core::docs`. Every command resolves the service's
// declared `cwd` from the store so the frontend can never spoof a
// path it doesn't already control via the service definition. The
// path-traversal guard inside `runhq_core::docs::safe_join` is the
// final defense — `<img src="../../../etc/passwd">` in a README is
// rejected with `AppError::Invalid` long before any read syscall.

/// Discover the documentation files for a service. Returns an empty
/// Vec when the project has no README / docs/ at all — the panel
/// then falls back to its no-docs empty state without surfacing an
/// error. Failures (missing service, permission denied on cwd) DO
/// surface so the user can fix them.
#[tauri::command]
pub async fn discover_project_docs(
    service_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProjectDoc>> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    docs::discover_docs(&cwd).await
}

/// Read a single doc by its relative-to-cwd path. Returns the raw
/// Markdown plus the doc's directory (used by the frontend to
/// resolve relative image / intra-doc link references).
#[tauri::command]
pub async fn read_project_doc(
    service_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> AppResult<DocContent> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    docs::read_doc(&cwd, &relative_path).await
}

/// Resolve a relative `<img src>` referenced from a doc into a
/// `data:` URI the webview can render. The frontend only calls this
/// for paths that are NOT http(s) URLs — those it loads directly.
///
/// `base_dir` matches `DocContent.base_dir` (the directory portion
/// of the doc's relative path). An empty `base_dir` treats the
/// `src` as anchored at the project root.
#[tauri::command]
pub async fn resolve_doc_image(
    service_id: String,
    base_dir: String,
    src: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let svc = state
        .store
        .service(&service_id)
        .ok_or_else(|| AppError::NotFound(service_id.clone()))?;
    let cwd = std::path::PathBuf::from(&svc.cwd);
    docs::resolve_doc_image(&cwd, &base_dir, &src).await
}

// ---- License & Compliance Scanner -----------------------------------------

#[tauri::command]
pub async fn scan_licenses(id: String, state: State<'_, AppState>) -> AppResult<LicenseScanResult> {
    let cwd = resolve_cwd(&id, &state)?;
    license::scan_licenses(&cwd).await
}

#[derive(Debug, Serialize)]
pub struct GenerateNoticesResult {
    pub content: String,
}

#[tauri::command]
pub async fn generate_third_party_notices(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<GenerateNoticesResult> {
    let cwd = resolve_cwd(&id, &state)?;
    let result = license::scan_licenses(&cwd).await?;
    let content = license::generate_third_party_notices(&result);
    Ok(GenerateNoticesResult { content })
}

#[tauri::command]
pub async fn write_third_party_notices(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    let result = license::scan_licenses(&cwd).await?;
    let content = license::generate_third_party_notices(&result);
    let target = cwd.join("THIRD-PARTY-NOTICES.md");
    std::fs::write(&target, &content)
        .map_err(|e| AppError::Other(format!("writing THIRD-PARTY-NOTICES.md: {e}")))?;
    Ok(target.to_string_lossy().to_string())
}
