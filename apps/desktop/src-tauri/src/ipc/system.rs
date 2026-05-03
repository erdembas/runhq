use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};

// ---- Misc ----------------------------------------------------------------

#[tauri::command]
pub fn open_path(path: PathBuf) -> AppResult<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        open::that(&url).map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}
