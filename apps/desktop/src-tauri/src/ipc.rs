//! Tauri IPC command surface.
//!
//! Every command exposed from this module is a thin adapter over
//! [`runhq_core`]. Domain-specific command groups live in focused
//! submodules and are re-exported here so the public `ipc::...` paths
//! used by Tauri stay stable.

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

pub(crate) fn resolve_cwd(id: &str, state: &State<'_, AppState>) -> AppResult<PathBuf> {
    state
        .store
        .service(id)
        .map(|s| s.cwd)
        .ok_or_else(|| AppError::NotFound(id.to_string()))
}
