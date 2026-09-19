use crate::AppState;
use runhq_core::{
    agents::{AgentWorkflow, CreateAgentWorkflow},
    AppResult,
};
use tauri::State;

#[tauri::command]
pub async fn agent_workflows(state: State<'_, AppState>) -> AppResult<Vec<AgentWorkflow>> {
    state.agents.workflows().await
}
#[tauri::command]
pub async fn agent_workflow_create(
    input: CreateAgentWorkflow,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_create(input).await
}
#[tauri::command]
pub async fn agent_workflow_implement(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_implement(&id).await
}
#[tauri::command]
pub async fn agent_workflow_review(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_review(&id).await
}
#[tauri::command]
pub async fn agent_workflow_setup(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_commands(&id, true).await
}
#[tauri::command]
pub async fn agent_workflow_checks(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_commands(&id, false).await
}
#[tauri::command]
pub async fn agent_workflow_preview(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_preview(&id).await
}
#[tauri::command]
pub async fn agent_workflow_integrate(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_integrate(&id).await
}
#[tauri::command]
pub async fn agent_workflow_cancel(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_cancel(&id).await
}
#[tauri::command]
pub async fn agent_workflow_cleanup(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_cleanup(&id).await
}

#[tauri::command]
pub async fn agent_workflow_transfer_files(
    id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_transfer_files(&id, paths).await
}
#[tauri::command]
pub async fn agent_workflow_inventory(
    state: State<'_, AppState>,
) -> AppResult<Vec<runhq_core::agents::WorkflowWorktree>> {
    state.agents.workflow_inventory().await
}
