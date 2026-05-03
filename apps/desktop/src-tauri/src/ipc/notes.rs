use runhq_core::error::{AppError, AppResult};
use runhq_core::notes::{self as core_notes, NoteFile};

// ---- Per-project Notes ----------------------------------------------------
//
// Multi-note edition. v0.10 expanded the per-service notebook from a
// single `.md` file to a directory of named files; the legacy single-
// file shape auto-migrates on first list/read so old users see no
// behavioural change beyond "now you can have more than one note".

#[tauri::command]
pub fn list_notes(service_id: String) -> AppResult<Vec<NoteFile>> {
    core_notes::list_notes(&service_id).map_err(AppError::from)
}

#[tauri::command]
pub fn read_note(service_id: String, name: String) -> AppResult<String> {
    core_notes::read_note(&service_id, &name).map_err(AppError::from)
}

#[tauri::command]
pub fn write_note(service_id: String, name: String, content: String) -> AppResult<()> {
    core_notes::write_note(&service_id, &name, &content).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_note(service_id: String, name: String) -> AppResult<bool> {
    core_notes::delete_note(&service_id, &name).map_err(AppError::from)
}

#[tauri::command]
pub fn create_note(service_id: String, requested_name: Option<String>) -> AppResult<String> {
    core_notes::create_note(&service_id, requested_name.as_deref()).map_err(AppError::from)
}

#[tauri::command]
pub fn read_all_notes(service_id: String) -> AppResult<String> {
    core_notes::read_all_notes(&service_id).map_err(AppError::from)
}

#[tauri::command]
pub fn list_noted_services() -> AppResult<Vec<String>> {
    core_notes::list_noted_services().map_err(AppError::from)
}
