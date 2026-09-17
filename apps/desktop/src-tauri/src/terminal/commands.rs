use tauri::ipc::Channel;

use crate::AppState;

use super::TerminalOutput;

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Named IPC parameters include the output channel and app state.
pub async fn terminal_create(
    id: String,
    stream_id: String,
    cwd: String,
    tool_id: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalOutput>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let command = tool_id
        .map(|id| state.agents.terminal_tool(&id))
        .transpose()
        .map_err(|e| e.to_string())?;
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if command.is_some() {
            terminals.create_command(&id, &stream_id, &cwd, cols, rows, on_output, command)
        } else {
            terminals.create(&id, &stream_id, &cwd, cols, rows, on_output)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn terminal_write(
    id: String,
    stream_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.write(&id, &stream_id, &data))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    stream_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.resize(&id, &stream_id, cols, rows))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn terminal_destroy(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.destroy(&id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

// Only updates a byte counter; no OS I/O or blocking wait on this path.
#[tauri::command]
pub fn terminal_acknowledge(
    id: String,
    stream_id: String,
    bytes: usize,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .acknowledge(&id, &stream_id, bytes)
        .map_err(|e| format!("{e:#}"))
}
