//! Tauri IPC command surface.
//!
//! Every command exposed from this module is a thin adapter over
//! [`runhq_core`]. Domain-specific command groups live in focused
//! submodules and are re-exported here so the public `ipc::...` paths
//! used by Tauri stay stable.

mod agent_canvas;
mod agent_workflows;
mod agent_workspace_data;
mod agents;
mod ai;
mod app_info;
mod conversations;
mod docs;
mod editors;
mod git;
mod license;
mod logs;
mod notes;
mod overview;
mod ports;
mod prefs;
mod process;
mod scanner;
mod services;
mod stacks;
mod system;
mod timeline;

pub use agent_canvas::*;
pub use agent_workflows::*;
pub use agent_workspace_data::*;
pub use agents::*;
pub use ai::*;
pub use app_info::*;
pub use conversations::*;
pub use docs::*;
pub use editors::*;
pub use git::*;
pub use license::*;
pub use logs::*;
pub use notes::*;
pub use overview::*;
pub use ports::*;
pub use prefs::*;
pub use process::*;
pub use scanner::*;
pub use services::*;
pub use stacks::*;
pub use system::*;
pub use timeline::*;

use std::path::PathBuf;

use runhq_core::error::{AppError, AppResult};
use tauri::State;

use crate::AppState;

/// Keep filesystem, SQLite and subprocess work off both the window event loop
/// and Tokio's async workers. Commands move owned inputs into this worker pool.
pub(super) async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::other(format!("Background command failed: {error}")))?
}

/// Preserve ordering for storage that relied on synchronous IPC serialization.
/// Wait outside the worker pool; once started, the worker owns the lock even
/// when its caller is cancelled before the underlying I/O finishes.
pub(super) async fn serialized_blocking<T: Send + 'static>(
    gate: &'static tokio::sync::Mutex<()>,
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let guard = gate.lock().await;
    blocking(move || {
        let _guard = guard;
        task()
    })
    .await
}

pub(crate) fn resolve_cwd(id: &str, state: &State<'_, AppState>) -> AppResult<PathBuf> {
    state
        .store
        .service(id)
        .map(|s| s.cwd)
        .ok_or_else(|| AppError::NotFound(id.to_string()))
}
