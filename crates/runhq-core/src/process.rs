//! Process supervisor.
//!
//! Responsibilities:
//! - Spawn child commands under the user's shell so familiar strings like
//!   `pnpm dev && tail -f foo.log` work as expected.
//! - Support **multiple commands per service**, each tracked independently
//!   with its own PID, status, and log buffer.
//! - Stream stdout/stderr line-by-line into [`LogStore`] and forward each
//!   line to the host via [`EventSink`].
//! - Graceful shutdown on stop: SIGTERM → configurable grace window → SIGKILL
//!   against the child's process group on Unix; `TerminateProcess` on Windows.

mod diagnostics;
mod lifecycle;
mod line_reader;
mod shell;
mod status;
mod stdio;
mod supervision;
mod supervisor;
mod types;

pub use supervisor::Supervisor;
pub use types::{CommandStatus, ServiceStatus, Status};
