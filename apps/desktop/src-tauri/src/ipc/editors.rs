use std::path::PathBuf;

use runhq_core::editors::{self as core_editors, DetectedEditor};
use runhq_core::error::AppResult;

// ---- Editors -------------------------------------------------------------

#[tauri::command]
pub async fn detect_editors() -> AppResult<Vec<DetectedEditor>> {
    Ok(core_editors::detect_editors().await)
}

#[tauri::command]
pub async fn open_in_editor(command: String, path: PathBuf) -> AppResult<()> {
    core_editors::open_in_editor(&command, &path).await
}
