use runhq_core::error::{AppError, AppResult};
use runhq_core::license::{self as core_license, LicenseScanResult};
use serde::Serialize;
use tauri::State;

use super::resolve_cwd;
use crate::AppState;

// ---- License & Compliance Scanner -----------------------------------------

#[tauri::command]
pub async fn scan_licenses(id: String, state: State<'_, AppState>) -> AppResult<LicenseScanResult> {
    let cwd = resolve_cwd(&id, &state)?;
    core_license::scan_licenses(&cwd).await
}

#[derive(Debug, Serialize)]
pub struct GenerateNoticesResult {
    pub content: String,
}

#[tauri::command]
pub async fn generate_third_party_notices(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<GenerateNoticesResult> {
    let cwd = resolve_cwd(&id, &state)?;
    let result = core_license::scan_licenses(&cwd).await?;
    let content = core_license::generate_third_party_notices(&result);
    Ok(GenerateNoticesResult { content })
}

#[tauri::command]
pub async fn write_third_party_notices(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let cwd = resolve_cwd(&id, &state)?;
    let result = core_license::scan_licenses(&cwd).await?;
    let content = core_license::generate_third_party_notices(&result);
    let target = cwd.join("THIRD-PARTY-NOTICES.md");
    std::fs::write(&target, &content)
        .map_err(|e| AppError::Other(format!("writing THIRD-PARTY-NOTICES.md: {e}")))?;
    Ok(target.to_string_lossy().to_string())
}
