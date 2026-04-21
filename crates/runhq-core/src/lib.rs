//! RunHQ core — headless domain logic.
//!
//! This crate is deliberately free of any Tauri, window, or UI dependency.
//! That keeps it:
//!
//! - **Fast to test** (no desktop runtime needed in CI).
//! - **Reusable** (a future CLI can embed the same supervisor).
//! - **Easy to reason about** (pure data + services, side-effects explicit).
//!
//! The crate exposes four primary services:
//!
//! | Module      | Responsibility                                            |
//! |-------------|-----------------------------------------------------------|
//! | [`state`]   | Persisted user config (`$RUNHQ_HOME/config.json`).    |
//! | [`process`] | Spawn/stop child processes with graceful shutdown.        |
//! | [`logs`]    | Per-service ring buffer (bounded memory).                 |
//! | [`ports`]   | Cross-platform TCP listener inspection and kill.          |
//! | [`scanner`] | Project auto-discovery via pluggable runtime providers.   |
//! | [`editors`] | Detect installed code editors and open paths in them.      |
//!
//! Side-effects on the outside world (UI events, IPC) are delivered via the
//! [`events::EventSink`] trait — the desktop shell provides a Tauri-backed
//! implementation, the CLI could provide a stdout one.

pub mod editors;
pub mod error;
pub mod events;
pub mod git;
pub mod logs;
pub mod paths;
pub mod ports;
pub mod process;
pub mod scanner;
pub mod state;

pub use error::{AppError, AppResult};
pub use events::EventSink;
