use runhq_core::error::{AppError, AppResult};
use runhq_core::state::Prefs;
use tauri::State;

use crate::AppState;

// ---- Preferences ---------------------------------------------------------

#[tauri::command]
pub fn get_prefs(state: State<'_, AppState>) -> AppResult<Prefs> {
    Ok(state.store.snapshot().prefs)
}

#[tauri::command]
pub fn update_prefs(prefs: Prefs, state: State<'_, AppState>) -> AppResult<Prefs> {
    state
        .store
        .update_prefs(|existing| *existing = prefs.clone())
        .map_err(AppError::from)?;
    Ok(prefs)
}
