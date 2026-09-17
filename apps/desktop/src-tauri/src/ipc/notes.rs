use runhq_core::error::{AppError, AppResult};
use runhq_core::notes::{self as core_notes, NoteFile};

// Notes use a shared temporary path for atomic saves and can migrate legacy
// files even on reads. Preserve serialized I/O while releasing the UI thread.
static NOTES_IO: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn notes_io<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    super::serialized_blocking(&NOTES_IO, task).await
}

// ---- Per-project Notes ----------------------------------------------------
//
// Multi-note edition. v0.10 expanded the per-service notebook from a
// single `.md` file to a directory of named files; the legacy single-
// file shape auto-migrates on first list/read so old users see no
// behavioural change beyond "now you can have more than one note".

#[tauri::command]
pub async fn list_notes(service_id: String) -> AppResult<Vec<NoteFile>> {
    notes_io(move || core_notes::list_notes(&service_id).map_err(AppError::from)).await
}

#[tauri::command]
pub async fn read_note(service_id: String, name: String) -> AppResult<String> {
    notes_io(move || core_notes::read_note(&service_id, &name).map_err(AppError::from)).await
}

#[tauri::command]
pub async fn write_note(service_id: String, name: String, content: String) -> AppResult<()> {
    notes_io(move || core_notes::write_note(&service_id, &name, &content).map_err(AppError::from))
        .await
}

#[tauri::command]
pub async fn delete_note(service_id: String, name: String) -> AppResult<bool> {
    notes_io(move || core_notes::delete_note(&service_id, &name).map_err(AppError::from)).await
}

#[tauri::command]
pub async fn create_note(service_id: String, requested_name: Option<String>) -> AppResult<String> {
    notes_io(move || {
        core_notes::create_note(&service_id, requested_name.as_deref()).map_err(AppError::from)
    })
    .await
}

#[tauri::command]
pub async fn read_all_notes(service_id: String) -> AppResult<String> {
    notes_io(move || core_notes::read_all_notes(&service_id).map_err(AppError::from)).await
}

#[tauri::command]
pub async fn list_noted_services() -> AppResult<Vec<String>> {
    notes_io(move || core_notes::list_noted_services().map_err(AppError::from)).await
}
