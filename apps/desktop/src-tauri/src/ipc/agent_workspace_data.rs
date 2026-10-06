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
