use runhq_core::error::{AppError, AppResult};
use runhq_core::process::ServiceStatus;
use tauri::State;

use crate::AppState;

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
