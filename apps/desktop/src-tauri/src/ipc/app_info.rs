use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};
use runhq_core::paths;
use serde::Serialize;

// ---- App metadata --------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub version: &'static str,
    pub state_dir: PathBuf,
}

#[tauri::command]
pub fn app_info() -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        state_dir: paths::runhq_home().map_err(AppError::from)?,
    })
}
