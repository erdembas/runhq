use runhq_core::error::AppResult;
use runhq_core::logs::LogLine;
use tauri::State;

use crate::AppState;

// ---- Logs ----------------------------------------------------------------

#[tauri::command]
pub fn get_logs(
    id: String,
    since_seq: Option<u64>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<LogLine>> {
    let since = since_seq.unwrap_or(0);
    let limit = limit.unwrap_or(2_000).min(10_000);
    Ok(if since == 0 {
        state.supervisor.logs.snapshot(&id)
    } else {
        state.supervisor.logs.tail(&id, since, limit)
    })
}

#[tauri::command]
pub fn clear_logs(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.supervisor.logs.clear(&id);
    Ok(())
}
