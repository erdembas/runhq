use runhq_core::error::{AppError, AppResult};
use runhq_core::state::StackDef;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

// ---- Stacks --------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct StackInput {
    #[serde(default)]
    pub command_names: std::collections::BTreeMap<String, Vec<String>>,
    pub name: String,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct StackStatus {
    pub errors: Vec<String>,
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
        command_names: input.command_names,
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

pub(super) async fn start_group(stack: StackDef, state: &AppState) -> AppResult<StackStatus> {
    // Validate the complete plan before starting anything. Runtime failures are reported per group.
    let mut plan = Vec::new();
    for id in &stack.service_ids {
        let service = state
            .store
            .service(id)
            .ok_or_else(|| AppError::NotFound(id.clone()))?;
        let commands = stack.selected_commands(&service)?;
        plan.push((service, commands));
    }
    let mut errors = Vec::new();
    for (service, commands) in plan {
        if stack.command_names.contains_key(&service.id) {
            for name in commands {
                match state.supervisor.start_cmd(service.clone(), &name).await {
                    Ok(_) | Err(AppError::AlreadyRunning(_)) => {}
                    Err(error) => errors.push(format!("{} / {}: {}", service.name, name, error)),
                }
            }
        } else if let Err(error) = state.supervisor.start_all(service.clone()).await {
            if !matches!(error, AppError::AlreadyRunning(_)) {
                errors.push(format!("{}: {}", service.name, error));
            }
        }
        if !stack.command_names.contains_key(&service.id) {
            if let Some(port) = service.port {
                runhq_core::ports::wait_for_port(port, std::time::Duration::from_secs(30)).await;
            }
        }
    }
    Ok(StackStatus {
        id: stack.id,
        total: stack.service_ids.len() as u32,
        running: stack
            .service_ids
            .iter()
            .filter(|id| state.supervisor.is_running(id))
            .count() as u32,
        errors,
    })
}

fn stop_group(stack: &StackDef, state: &AppState) -> Vec<String> {
    let mut errors = Vec::new();
    for id in &stack.service_ids {
        if let Some(commands) = stack.command_names.get(id) {
            for name in commands {
                if let Err(error) = state.supervisor.stop_cmd(id, name) {
                    errors.push(format!("{id} / {name}: {error}"));
                }
            }
        } else if let Err(error) = state.supervisor.stop_all(id) {
            errors.push(format!("{id}: {error}"));
        }
    }
    errors
}

#[tauri::command]
pub async fn start_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    start_group(stack, &state).await
}

#[tauri::command]
pub fn stop_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let errors = stop_group(&stack, &state);
    Ok(StackStatus {
        id: stack.id,
        running: 0,
        total: stack.service_ids.len() as u32,
        errors,
    })
}

#[tauri::command]
pub async fn restart_stack(id: String, state: State<'_, AppState>) -> AppResult<StackStatus> {
    let stack = state
        .store
        .stack(&id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let errors = stop_group(&stack, &state);
    if !errors.is_empty() {
        return Err(AppError::Other(errors.join("\n")));
    }
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    start_group(stack, &state).await
}

#[tauri::command]
pub async fn agent_run_multi_workspace(
    id: String,
    stop: bool,
    state: State<'_, AppState>,
) -> AppResult<StackStatus> {
    let stack_id = format!("workspace:{id}");
    let stack = state
        .store
        .stack(&stack_id)
        .ok_or_else(|| AppError::NotFound(stack_id.clone()))?;
    if stop {
        return stop_stack(stack_id, state);
    }
    let services = stack
        .service_ids
        .iter()
        .map(|id| {
            state
                .store
                .service(id)
                .ok_or_else(|| AppError::NotFound(id.clone()))
        })
        .collect::<AppResult<Vec<_>>>()?;
    state.agents.validate_workspace_run(&id, &services)?;
    start_group(stack, &state).await
}
