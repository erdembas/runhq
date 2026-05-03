use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};
use runhq_core::state::{CommandEntry, ServiceDef};
use serde::Deserialize;
use tauri::State;

use super::overview::open_scan_history_db;
use crate::AppState;

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
    /// See [`runhq_core::state::ServiceDef::hide_dashboard`].
    /// Defaulting to `false` keeps the IPC surface backward
    /// compatible: an older frontend (or a third-party caller)
    /// that doesn't know about the field still gets the
    /// pre-existing "show on dashboard" behaviour.
    #[serde(default)]
    pub hide_dashboard: bool,
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
        hide_dashboard: input.hide_dashboard,
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
