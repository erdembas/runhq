//! Embedded terminal backed by a host PTY.
//!
//! Each service can have at most one active PTY session. The PTY is spawned
//! in the service's `cwd` with the user's default shell. Output is forwarded
//! to the frontend through a typed Tauri [`Channel`] (one channel per
//! terminal id), bypassing the global event bus.

pub mod commands;
mod manager;
mod pipeline;
mod shell;
mod types;

pub use commands::{terminal_create, terminal_destroy, terminal_resize, terminal_write};
pub use manager::TerminalManager;
pub use types::TerminalOutput;
