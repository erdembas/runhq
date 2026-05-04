//! Process supervisor.
//!
//! Responsibilities:
//! - Spawn child commands under the user's shell so familiar strings like
//!   `pnpm dev && tail -f foo.log` work as expected.
//! - Support **multiple commands per service**, each tracked independently
//!   with its own PID, status, and log buffer.
//! - Run service commands under a PTY, then stream readonly terminal output
//!   into [`LogStore`] and forward each line to the host via [`EventSink`].
//! - Graceful shutdown on stop: SIGTERM → configurable grace window → SIGKILL
//!   against the child's process group on Unix; `TerminateProcess` on Windows.

mod diagnostics;
mod lifecycle;
mod pty;
mod shell;
mod status;
mod supervisor;
mod types;

pub use supervisor::Supervisor;
pub use types::{CommandStatus, ServiceStatus, Status};
