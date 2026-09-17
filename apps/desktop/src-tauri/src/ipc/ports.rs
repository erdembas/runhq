use runhq_core::error::AppResult;
use runhq_core::ports::{self as core_ports, ListeningPort};

// ---- Ports ---------------------------------------------------------------

#[tauri::command]
pub async fn list_ports() -> AppResult<Vec<ListeningPort>> {
    super::blocking(core_ports::list).await
}

#[tauri::command]
pub async fn kill_port(port: u16) -> AppResult<Vec<u32>> {
    super::blocking(move || core_ports::kill_port(port)).await
}
