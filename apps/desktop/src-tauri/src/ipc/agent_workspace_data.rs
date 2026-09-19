use crate::AppState;
use runhq_core::{agents::*, AppResult};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn agent_handoff_create(
    source_id: String,
    input: CreateAgentSession,
    state: State<'_, AppState>,
) -> AppResult<AgentSession> {
    state.agents.handoff_create(&source_id, input).await
}

#[tauri::command]
pub async fn agent_workspace_data(state: State<'_, AppState>) -> AppResult<Vec<WorkspaceRecord>> {
    let agents = state.agents.clone();
    super::blocking(move || agents.workspace_records()).await
}
#[tauri::command]
pub async fn agent_workspace_save(
    key: String,
    value: Option<Value>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let agents = state.agents.clone();
    super::blocking(move || agents.workspace_save(key, value)).await
}
#[tauri::command]
pub async fn agent_history_search(
    query: AgentHistoryQuery,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentHistoryHit>> {
    let agents = state.agents.clone();
    super::blocking(move || agents.history_search(query)).await
}
#[tauri::command]
pub async fn agent_history_export(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<AgentHistoryArchive> {
    let agents = state.agents.clone();
    super::blocking(move || agents.history_export(project_id)).await
}
#[tauri::command]
pub async fn agent_history_import(
    project_id: String,
    archive: AgentHistoryArchive,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    let agents = state.agents.clone();
    super::blocking(move || agents.history_import(&project_id, archive)).await
}
#[tauri::command]
pub async fn agent_history_retention_preview(
    project_id: Option<String>,
    before: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentSession>> {
    let agents = state.agents.clone();
    super::blocking(move || agents.history_retention_preview(project_id, before)).await
}
#[tauri::command]
pub async fn agent_history_retention_remove(
    id: String,
    revision: u64,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let agents = state.agents.clone();
    super::blocking(move || agents.history_retention_remove(&id, revision)).await
}
#[tauri::command]
pub async fn agent_context_file(
    project_id: String,
    session_id: Option<String>,
    relative_path: String,
    state: State<'_, AppState>,
) -> AppResult<AgentContextFile> {
    let agents = state.agents.clone();
    super::blocking(move || agents.context_file(&project_id, session_id.as_deref(), &relative_path))
        .await
}
