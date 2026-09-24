use crate::AppState;
use runhq_core::{
    agents::{AgentWorkflow, CreateAgentWorkflow, UpdateWorkflowSteps, WorkflowDestination},
    AppResult,
};
use tauri::State;

#[tauri::command]
pub async fn agent_workflow_edit(
    id: String,
    editing: bool,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_edit(&id, editing).await
}
#[tauri::command]
pub async fn agent_workflow_update_steps(
    id: String,
    input: UpdateWorkflowSteps,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_update_steps(&id, input).await
}
#[tauri::command]
pub async fn agent_workflow_review_decision(
    id: String,
    step_id: String,
    finished_at: i64,
    decision: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state
        .agents
        .workflow_review_decision(&id, &step_id, finished_at, &decision)
        .await
}

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
pub async fn agent_workflow_launch(
    id: String,
    after_session_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_launch(&id, after_session_id).await
}
#[tauri::command]
pub async fn agent_workflow_implement(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_implement(&id).await
}
/// Run one named task, or whichever step the workflow is on when none is named.
#[tauri::command]
pub async fn agent_workflow_run_step(
    id: String,
    step_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    match step_id {
        Some(step) => state.agents.workflow_run_named_step(&id, &step).await,
        None => state.agents.workflow_run_step(&id).await,
    }
}
/// Start every task this workflow can run right now, and land the results that are ready.
#[tauri::command]
pub async fn agent_workflow_schedule(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state.agents.workflow_schedule(&id).await
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
    destination: Option<WorkflowDestination>,
    state: State<'_, AppState>,
) -> AppResult<AgentWorkflow> {
    state
        .agents
        .workflow_integrate(&id, destination.unwrap_or_default())
        .await
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

#[tauri::command]
pub async fn agent_workflow_import_recipes(path: String) -> AppResult<serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        runhq_core::agents::import_workflow_recipes(std::path::Path::new(&path))
    })
    .await
    .map_err(|error| runhq_core::AppError::other(error.to_string()))?
}

#[tauri::command]
pub async fn agent_pipeline_import(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<runhq_core::agents::PipelineRun> {
    let agents = state.agents.clone();
    tauri::async_runtime::spawn_blocking(move || agents.pipeline_import(path.into()))
        .await
        .map_err(|e| runhq_core::AppError::other(e.to_string()))?
}
#[tauri::command]
pub async fn agent_pipelines(
    state: State<'_, AppState>,
) -> AppResult<Vec<runhq_core::agents::PipelineSummary>> {
    state.agents.pipeline_summaries()
}
#[tauri::command]
pub async fn agent_pipeline_get(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<runhq_core::agents::PipelineRun> {
    state.agents.pipeline_get(&id)
}
#[tauri::command]
pub async fn agent_pipeline_control(
    id: String,
    revision: u64,
    action: String,
    step_id: Option<String>,
    backend: String,
    reviewer: String,
    state: State<'_, AppState>,
) -> AppResult<runhq_core::agents::PipelineRun> {
    state
        .agents
        .pipeline_control(&id, revision, &action, step_id, backend, reviewer)
        .await
}
