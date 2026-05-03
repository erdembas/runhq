use runhq_core::error::{AppError, AppResult};
use runhq_core::state::StackDef;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

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
