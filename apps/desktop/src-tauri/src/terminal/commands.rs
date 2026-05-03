use tauri::ipc::Channel;

use crate::AppState;

use super::TerminalOutput;

#[tauri::command]
pub fn terminal_create(
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalOutput>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .create(&id, &cwd, cols, rows, on_output)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .write(&id, &data)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .resize(&id, cols, rows)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn terminal_destroy(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.terminals.destroy(&id).map_err(|e| format!("{e:#}"))
}
