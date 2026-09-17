use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};
use runhq_core::scanner::{self as core_scanner, ProjectCandidate};

// ---- Scanner -------------------------------------------------------------

#[tauri::command]
pub async fn scan_directory(path: PathBuf) -> AppResult<Vec<ProjectCandidate>> {
    super::blocking(move || {
        if !path.is_dir() {
            return Err(AppError::Invalid(format!(
                "not a directory: {}",
                path.display()
            )));
        }
        core_scanner::scan(&path)
    })
    .await
}

#[tauri::command]
pub async fn detect_project(path: PathBuf) -> AppResult<Option<ProjectCandidate>> {
    super::blocking(move || {
        if !path.is_dir() {
            return Ok(None);
        }
        core_scanner::detect_one(&path)
    })
    .await
}
