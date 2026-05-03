use serde::Serialize;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::process_group::JobObject;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Stopped,
    Starting,
    Running,
    Stopping,
    Exited,
    Crashed,
}

impl Status {
    fn priority(self) -> u8 {
        match self {
            Status::Running => 6,
            Status::Starting => 5,
            Status::Stopping => 4,
            Status::Crashed => 3,
            Status::Exited => 2,
            Status::Stopped => 1,
        }
    }

    pub fn aggregate(statuses: &[Status]) -> Status {
        statuses
            .iter()
            .max_by_key(|s| s.priority())
            .copied()
            .unwrap_or(Status::Stopped)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandStatus {
    pub name: String,
    pub status: Status,
    pub pid: Option<u32>,
    pub started_at_ms: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub status: Status,
    pub pid: Option<u32>,
    pub started_at_ms: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub commands: Vec<CommandStatus>,
    /// Correlation id of the currently-active run for this service, if any.
    ///
    /// Minted in `start_all` / `start_cmd` at the very moment the supervisor
    /// commits to a new run, BEFORE any child process is spawned — so the
    /// first `$ <cmd>` echo that leaves the box is already tagged with this
    /// id. Cleared to `None` when the last command for the service exits.
    ///
    /// The UI uses this id to attribute incoming log lines to the lifecycle
    /// event deterministically, with zero dependence on IPC ordering or
    /// wall-clock jitter between `emit_log` and `emit_status`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

pub(super) struct Running {
    pub(super) pid: u32,
    pub(super) started_at_ms: i64,
    pub(super) stop_tx: Option<oneshot::Sender<()>>,
    pub(super) _task: JoinHandle<()>,
    /// Windows-only Job Object that owns the supervised process tree.
    ///
    /// Held as long as the run is alive; dropping it (on supervise
    /// completion or stop) closes the job and triggers
    /// `KILL_ON_JOB_CLOSE` semantics, terminating every descendant
    /// process the user's command spawned (`pnpm dev` → `node` →
    /// `esbuild` → workers, etc.). Without this, Windows leaves
    /// orphaned processes holding dev ports — the symptom users see is
    /// "stop service" succeeds but `:3000` is still occupied.
    ///
    /// On non-Windows targets this is a zero-cost no-op shim; the Unix
    /// `setsid()` + `killpg()` path in [`graceful_kill`] handles tree
    /// teardown there. Carrying the field unconditionally keeps the
    /// struct identical across platforms and avoids `cfg`-sprawl on
    /// every construction site.
    pub(super) _job: Option<JobObject>,
}

pub(super) fn process_key(service_id: &str, cmd_name: &str) -> String {
    format!("{service_id}::{cmd_name}")
}
