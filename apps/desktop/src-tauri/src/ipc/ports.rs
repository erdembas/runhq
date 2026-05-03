use runhq_core::error::AppResult;
use runhq_core::ports::{self as core_ports, ListeningPort};

// ---- Ports ---------------------------------------------------------------

#[tauri::command]
pub fn list_ports() -> AppResult<Vec<ListeningPort>> {
    core_ports::list()
}

#[tauri::command]
pub fn kill_port(port: u16) -> AppResult<Vec<u32>> {
    core_ports::kill_port(port)
}
