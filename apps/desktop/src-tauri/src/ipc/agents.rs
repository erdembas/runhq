use crate::AppState;
use runhq_core::{agents::*, AppResult};
use serde_json::Value;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn agent_projects(state: State<'_, AppState>) -> AppResult<Vec<AgentProject>> {
    let agents = state.agents.clone();
    let store = state.store.clone();
    super::blocking(move || {
        for service in store.services() {
            if service.cwd.is_dir() {
                agents.add_project(service.name, service.cwd)?;
            }
        }
        agents.projects()
    })
    .await
}
#[tauri::command]
pub async fn agent_add_project(
    name: String,
    path: std::path::PathBuf,
    state: State<'_, AppState>,
) -> AppResult<AgentProject> {
    let agents = state.agents.clone();
    super::blocking(move || agents.add_project(name, path)).await
}
#[tauri::command]
pub async fn agent_sessions(state: State<'_, AppState>) -> AppResult<Vec<AgentSession>> {
    let agents = state.agents.clone();
    super::blocking(move || Ok(agents.sessions())).await
}
#[tauri::command]
pub async fn agent_snapshot(
    id: String,
    before: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<AgentSnapshot> {
    let agents = state.agents.clone();
    super::blocking(move || agents.snapshot(&id, before)).await
}
#[tauri::command]
pub async fn agent_backends(state: State<'_, AppState>) -> AppResult<Vec<AgentBackend>> {
    Ok(state.agents.detect().await)
}
#[tauri::command]
pub async fn agent_save_tool(tool: AgentTool, state: State<'_, AppState>) -> AppResult<()> {
    let agents = state.agents.clone();
    super::blocking(move || agents.save_tool(tool)).await
}
#[tauri::command]
pub async fn agent_catalog(
    backend: String,
    executable: String,
    project_id: String,
    session_id: Option<String>,
    model: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state
        .agents
        .catalog(backend, executable, project_id, session_id, model)
        .await
}
#[tauri::command]
pub async fn agent_create(
    input: CreateAgentSession,
    state: State<'_, AppState>,
) -> AppResult<AgentSession> {
    state.agents.create(input).await
}
#[tauri::command]
pub async fn agent_start(
    input: AgentTurnInput,
    state: State<'_, AppState>,
) -> AppResult<AgentSession> {
    state.agents.start(input).await
}
#[tauri::command]
pub async fn agent_answer(
    id: String,
    request_id: String,
    value: Value,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.agents.answer(&id, &request_id, value).await
}
#[tauri::command]
pub async fn agent_interrupt(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.agents.interrupt(&id).await
}
#[tauri::command]
pub async fn agent_steer(id: String, text: String, state: State<'_, AppState>) -> AppResult<()> {
    state.agents.steer(&id, text).await
}
#[tauri::command]
pub async fn agent_update(
    id: String,
    title: Option<String>,
    archived: Option<bool>,
    read: bool,
    state: State<'_, AppState>,
) -> AppResult<AgentSession> {
    let agents = state.agents.clone();
    super::blocking(move || agents.update(&id, title, archived, read)).await
}
#[tauri::command]
pub async fn agent_delete(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let agents = state.agents.clone();
    super::blocking(move || {
        agents.delete_session(&id)?;
        let _ = app.emit("agent://deleted", &id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn agent_workspace_diff(id: String, state: State<'_, AppState>) -> AppResult<String> {
    let agents = state.agents.clone();
    super::git::read(move || {
        let cwd = agents.session(&id)?.cwd;
        runhq_core::git::diff_all_raw(std::path::Path::new(&cwd))
    })
    .await
}
