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

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};
use crate::events::EventSink;
use crate::logs::{LogStore, Stream};
use crate::resources::{ResourceSample, ResourceSampler};
use crate::state::{CommandEntry, ServiceDef};

/// How often the supervisor samples per-service CPU + memory.
///
/// 2s is the sweet spot: frequent enough that UI sparklines feel live when
/// a service spikes, infrequent enough that the sysinfo refresh (which walks
/// every running process) stays well below 1% of the supervisor's own CPU
/// budget on a laptop with a dozen running services.
const RESOURCE_SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

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

struct Running {
    pid: u32,
    started_at_ms: i64,
    stop_tx: Option<oneshot::Sender<()>>,
    _task: JoinHandle<()>,
}

fn process_key(service_id: &str, cmd_name: &str) -> String {
    format!("{service_id}::{cmd_name}")
}

/// The supervisor — cheap to clone (internally an `Arc` structure).
pub struct Supervisor {
    sink: Arc<dyn EventSink>,
    pub logs: LogStore,
    running: Arc<Mutex<HashMap<String, Running>>>,
    statuses: Arc<Mutex<HashMap<String, ServiceStatus>>>,
    last_resources: Arc<Mutex<HashMap<String, ResourceSample>>>,
    /// Active run id per service, keyed by service_id.
    ///
    /// An entry is inserted at the top of `start_all` / `start_cmd` (before
    /// any spawn), read by every code path that emits a log line for this
    /// service during the run, and removed by the supervision task once
    /// the *last* command for the service has terminated. Lines that
    /// arrive after the entry is cleared (e.g. the child-task emitted
    /// `[exited]` closer races the next `start_cmd`) carry `None` — the
    /// client treats those as orphan lines rather than misattributing
    /// them.
    run_ids: Arc<Mutex<HashMap<String, String>>>,
}

impl Supervisor {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            logs: LogStore::new(),
            running: Arc::new(Mutex::new(HashMap::new())),
            statuses: Arc::new(Mutex::new(HashMap::new())),
            last_resources: Arc::new(Mutex::new(HashMap::new())),
            run_ids: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Read the active run id for a service (if any). Cloning once under
    /// the lock keeps the critical section tiny — no long borrow leaks
    /// into the async codepaths downstream.
    fn current_run_id(&self, service_id: &str) -> Option<String> {
        self.run_ids.lock().get(service_id).cloned()
    }

    pub fn get_resources(&self, service_id: &str) -> Option<ResourceSample> {
        self.last_resources.lock().get(service_id).copied()
    }

    /// Long-running CPU + memory sampler. Ticks every
    /// [`RESOURCE_SAMPLE_INTERVAL`] and emits a `ResourceSample` for each
    /// currently-running service via [`EventSink::emit_resources`]. Never
    /// returns under normal operation — the caller is expected to drive it
    /// from a spawned task scoped to the app's lifetime.
    ///
    /// We can't call `tokio::spawn` from `Supervisor::new()` directly
    /// because Tauri's `setup()` callback runs before the async runtime is
    /// active; the caller (Tauri shell) picks the right runtime to spawn
    /// us on — usually `tauri::async_runtime::spawn`.
    ///
    /// The sysinfo refresh itself runs inside `spawn_blocking` so a slow
    /// /proc walk can't stall the tokio runtime that IPC handlers share.
    /// One refresh per tick covers every service cheaply — a per-service
    /// fan-out would duplicate the process-table walk pointlessly.
    pub async fn run_resource_sampler(self: Arc<Self>) {
        let sampler = Arc::new(ResourceSampler::new());
        let mut interval = tokio::time::interval(RESOURCE_SAMPLE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip the immediate first tick — the sampler primed in `new()`
        // already has one snapshot, but the UI hasn't had a chance to
        // subscribe yet on app start. Waiting one interval also gives
        // sysinfo a small gap between prime and first real measurement,
        // which tightens the CPU% delta it reports.
        interval.tick().await;

        loop {
            interval.tick().await;

            // Collect "service_id -> [root pid, ...]" under the lock, then
            // drop the lock before blocking on sysinfo. Holding `running`
            // during a 100ms refresh would serialize with start/stop which
            // we need to stay snappy.
            let service_pids: HashMap<String, Vec<u32>> = {
                let map = self.running.lock();
                let mut out: HashMap<String, Vec<u32>> = HashMap::new();
                for (key, r) in map.iter() {
                    if let Some(svc_id) = key.split("::").next() {
                        out.entry(svc_id.to_string()).or_default().push(r.pid);
                    }
                }
                out
            };

            if service_pids.is_empty() {
                continue;
            }

            let sampler_clone = sampler.clone();
            let samples = tokio::task::spawn_blocking(move || {
                service_pids
                    .into_iter()
                    .map(|(id, pids)| (id, sampler_clone.sample(&pids)))
                    .collect::<Vec<_>>()
            })
            .await;

            if let Ok(samples) = samples {
                let mut cache = self.last_resources.lock();
                for (id, sample) in samples {
                    self.sink.emit_resources(&id, &sample);
                    cache.insert(id, sample);
                }
            }
        }
    }

    // ---- Service-level operations ------------------------------------------

    pub async fn start_all(&self, svc: ServiceDef) -> AppResult<ServiceStatus> {
        if svc.cmds.is_empty() {
            return Err(AppError::Invalid(format!(
                "service '{}' has no commands",
                svc.name
            )));
        }
        for entry in &svc.cmds {
            let key = process_key(&svc.id, &entry.name);
            if self.running.lock().contains_key(&key) {
                return Err(AppError::AlreadyRunning(format!(
                    "{}:{}",
                    svc.id, entry.name
                )));
            }
        }

        // Mint the run id FIRST — before `start_one` even emits its shell
        // prompt echo. This is the whole point of the server-side run id:
        // every byte the child produces, including the `$ <cmd>` banner
        // pushed at the top of `start_one`, has to be tagged with the
        // same id the lifecycle event will carry, or the UI has to fall
        // back to heuristics.
        let run_id = uuid::Uuid::new_v4().to_string();
        self.run_ids.lock().insert(svc.id.clone(), run_id);

        for entry in &svc.cmds {
            let _ = self.start_one(&svc, entry).await;
        }

        let agg = self.aggregate_status(&svc);
        self.set_status(agg.clone());

        Ok(agg)
    }

    pub async fn start_cmd(&self, svc: ServiceDef, cmd_name: &str) -> AppResult<ServiceStatus> {
        let entry = svc
            .cmds
            .iter()
            .find(|e| e.name == cmd_name)
            .ok_or_else(|| AppError::NotFound(format!("{}:{}", svc.id, cmd_name)))?;

        let key = process_key(&svc.id, cmd_name);
        if self.running.lock().contains_key(&key) {
            return Err(AppError::AlreadyRunning(key));
        }

        // Reuse the existing run id when another command of this service
        // is already in flight (the new command joins the ongoing run);
        // otherwise mint a fresh one. Locking once and using the entry
        // API keeps this atomic — two concurrent start_cmd calls for the
        // same service can't end up minting two different run ids.
        {
            let mut guard = self.run_ids.lock();
            guard
                .entry(svc.id.clone())
                .or_insert_with(|| uuid::Uuid::new_v4().to_string());
        }

        self.start_one(&svc, entry).await?;
        let agg = self.aggregate_status(&svc);
        self.set_status(agg.clone());
        Ok(agg)
    }

    pub fn stop_all(&self, svc_id: &str) -> AppResult<()> {
        let keys: Vec<String> = self
            .running
            .lock()
            .keys()
            .filter(|k| k.starts_with(&format!("{svc_id}::")))
            .cloned()
            .collect();

        for key in keys {
            self.stop_one_internal(&key);
        }
        Ok(())
    }

    pub fn stop_cmd(&self, svc_id: &str, cmd_name: &str) -> AppResult<()> {
        let key = process_key(svc_id, cmd_name);
        if !self.running.lock().contains_key(&key) {
            return Ok(());
        }
        self.stop_one_internal(&key);
        Ok(())
    }

    pub fn service_status(&self, svc: &ServiceDef) -> ServiceStatus {
        self.aggregate_status(svc)
    }

    pub fn is_running(&self, svc_id: &str) -> bool {
        let map = self.running.lock();
        map.keys().any(|k| k.starts_with(&format!("{svc_id}::")))
    }

    // ---- Single command lifecycle ------------------------------------------

    async fn start_one(&self, svc: &ServiceDef, entry: &CommandEntry) -> AppResult<()> {
        let key = process_key(&svc.id, &entry.name);
        let log_key = key.clone();

        // Snapshot the active run id ONCE here and flow the same clone
        // through every code path that might push a log line for this
        // command — the prompt echo, pre-command banners, a spawn
        // failure, stdout/stderr readers, and the `[exited ...]` closer
        // emitted by the supervision task after the child dies. This
        // guarantees the full transcript of a single run carries a
        // single, stable id, regardless of whether a concurrent start
        // (on a different command of the same service) later mutates
        // the supervisor's `run_ids` map.
        let run_id = self.current_run_id(&svc.id);

        // Echo the command being run as the very first line of the log
        // buffer, shell-prompt style. Gives the user one-glance context —
        // "which exact string did we invoke?" — without polluting the
        // transcript with a paragraph of synthetic `▶ starting` /
        // `▶ started (pid X)` banners.
        {
            let line = self.logs.push(
                &log_key,
                Stream::System,
                format!("$ {}", entry.cmd),
                run_id.clone(),
            );
            self.sink.emit_log(&svc.id, &entry.name, &line);
        }

        let (program, args) = shell_command(&entry.cmd);
        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(&svc.cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true);

        // Persuade CLIs that lose their TTY through `Stdio::piped()` to keep
        // emitting ANSI color. Covers the Node ecosystem (chalk/supports-color
        // via FORCE_COLOR), BSD conventions (CLICOLOR_FORCE), Cargo's own
        // toggle, and advertises a 256-color-capable terminal. Set before the
        // user env so explicit overrides still win.
        cmd.env("FORCE_COLOR", "1")
            .env("CLICOLOR_FORCE", "1")
            .env("CARGO_TERM_COLOR", "always")
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor");

        for (k, v) in &svc.env {
            cmd.env(k, v);
        }

        if let Some(path_extra) = &svc.path_override {
            let extra = path_extra.trim();
            if !extra.is_empty() {
                let current = std::env::var("PATH").unwrap_or_default();
                cmd.env("PATH", format!("{extra}:{current}"));
            }
        }

        if let Some(pre) = &svc.pre_command {
            let pre_trimmed = pre.trim();
            if !pre_trimmed.is_empty() {
                let (pre_prog, pre_args) = shell_command(pre_trimmed);
                let pre_status = Command::new(&pre_prog)
                    .args(&pre_args)
                    .current_dir(&svc.cwd)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .stdin(Stdio::null())
                    .status()
                    .await;
                match pre_status {
                    Ok(s) if s.success() => {
                        let line = self.logs.push(
                            &log_key,
                            Stream::System,
                            format!("✓ pre-command succeeded: {pre_trimmed}"),
                            run_id.clone(),
                        );
                        self.sink.emit_log(&svc.id, &entry.name, &line);
                    }
                    Ok(s) => {
                        let code = s.code().unwrap_or(-1);
                        let msg = format!("✗ pre-command exited with code {code}: {pre_trimmed}");
                        let line = self
                            .logs
                            .push(&log_key, Stream::System, msg, run_id.clone());
                        self.sink.emit_log(&svc.id, &entry.name, &line);
                        return Err(AppError::Other(format!(
                            "pre-command failed for '{}'",
                            entry.name
                        )));
                    }
                    Err(e) => {
                        let msg = format!("✗ pre-command failed: {pre_trimmed} — {e}");
                        let line = self
                            .logs
                            .push(&log_key, Stream::System, msg, run_id.clone());
                        self.sink.emit_log(&svc.id, &entry.name, &line);
                        return Err(AppError::Other(format!(
                            "pre-command failed for '{}'",
                            entry.name
                        )));
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            unsafe {
                cmd.pre_exec(|| {
                    let _ = nix::unistd::setsid();
                    Ok(())
                });
            }
        }

        let mut child: Child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("failed to spawn: {e}");
                let line = self
                    .logs
                    .push(&log_key, Stream::System, msg.clone(), run_id.clone());
                self.sink.emit_log(&svc.id, &entry.name, &line);
                return Err(AppError::Other(msg));
            }
        };

        let pid = child.id().unwrap_or(0);
        let started_at_ms = chrono::Utc::now().timestamp_millis();

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            spawn_line_reader(
                &log_key,
                out,
                Stream::Stdout,
                self.logs.clone(),
                self.sink.clone(),
                svc.id.clone(),
                entry.name.clone(),
                run_id.clone(),
            );
        }
        if let Some(err) = stderr {
            spawn_line_reader(
                &log_key,
                err,
                Stream::Stderr,
                self.logs.clone(),
                self.sink.clone(),
                svc.id.clone(),
                entry.name.clone(),
                run_id.clone(),
            );
        }

        let (stop_tx, stop_rx) = oneshot::channel();

        let task_key = key.clone();
        let task_svc_id = svc.id.clone();
        let task_cmd_name = entry.name.clone();
        let task_logs = self.logs.clone();
        let task_sink = self.sink.clone();
        let task_running_map = self.running.clone();
        let task_statuses = self.statuses.clone();
        let task_run_ids = self.run_ids.clone();
        // Capture the run id by value so the closing `[exited]` line is
        // stamped with the *original* run's id even if the supervisor's
        // `run_ids` map has since been mutated by a rapid restart on a
        // sibling command.
        let task_run_id = run_id.clone();
        let grace = Duration::from_millis(svc.grace_ms);

        let task = tokio::spawn(async move {
            let outcome = supervise(&mut child, stop_rx, grace).await;
            let (status, err_msg) = match outcome.kind {
                Outcome::Exited | Outcome::Killed => (Status::Exited, None),
                Outcome::Crashed(e) => (Status::Crashed, Some(e)),
            };

            // One terse closing line so when the user scrolls back they
            // can tell where a run ended and distinguish clean shutdown
            // from crash without opening the status drawer.
            let text = match (&err_msg, outcome.exit_code) {
                (Some(e), _) => format!("[crashed: {e}]"),
                (None, Some(code)) => format!("[exited code {code}]"),
                (None, None) => "[exited]".to_string(),
            };
            let line = task_logs.push(&task_key, Stream::System, text, task_run_id.clone());
            task_sink.emit_log(&task_svc_id, &task_cmd_name, &line);

            task_running_map.lock().remove(&task_key);

            // Clear the active run id once the LAST command of this
            // service has terminated. We check `running` under lock
            // after our own removal — if no sibling keys remain, the
            // run is over and subsequent ad-hoc pushes (should they
            // exist) must not inherit a stale id. Guarding with
            // `task_run_id == current` makes the removal idempotent
            // against a sibling command starting a *new* run mid-exit:
            // we only wipe what we ourselves installed.
            let svc_prefix = format!("{}::", task_svc_id);
            let any_sibling = {
                let map = task_running_map.lock();
                map.keys().any(|k| k.starts_with(&svc_prefix))
            };
            if !any_sibling {
                if let Some(our_id) = task_run_id.as_ref() {
                    let mut guard = task_run_ids.lock();
                    if let Some(active) = guard.get(&task_svc_id) {
                        if active == our_id {
                            guard.remove(&task_svc_id);
                        }
                    }
                }
            }

            let final_cmd = CommandStatus {
                name: task_cmd_name,
                status,
                pid: None,
                started_at_ms: Some(started_at_ms),
                exit_code: outcome.exit_code,
                error: err_msg,
            };
            let mut map = task_statuses.lock();
            let entry = map
                .entry(task_svc_id.clone())
                .or_insert_with(|| ServiceStatus {
                    id: task_svc_id.clone(),
                    status: Status::Stopped,
                    pid: None,
                    started_at_ms: None,
                    exit_code: None,
                    error: None,
                    commands: vec![],
                    run_id: None,
                });
            if let Some(existing) = entry.commands.iter_mut().find(|c| c.name == final_cmd.name) {
                *existing = final_cmd;
            } else {
                entry.commands.push(final_cmd);
            }
            let agg =
                Status::aggregate(&entry.commands.iter().map(|c| c.status).collect::<Vec<_>>());
            entry.status = agg;
            // Sync the run id on the status snapshot with whatever the
            // supervisor currently considers active for this service.
            // On the terminal transition (all commands exited), this
            // resolves to `None` and the client sees a clean "run is
            // over" signal; otherwise it reflects the id of the still-
            // running sibling(s) so a mid-flight restart stays
            // consistent.
            entry.run_id = task_run_ids.lock().get(&task_svc_id).cloned();
            task_sink.emit_status(&*entry);
        });

        self.running.lock().insert(
            key,
            Running {
                pid,
                started_at_ms,
                stop_tx: Some(stop_tx),
                _task: task,
            },
        );

        let cmd_status = CommandStatus {
            name: entry.name.clone(),
            status: Status::Running,
            pid: Some(pid),
            started_at_ms: Some(started_at_ms),
            exit_code: None,
            error: None,
        };
        let mut map = self.statuses.lock();
        let status_entry = map.entry(svc.id.clone()).or_insert_with(|| ServiceStatus {
            id: svc.id.clone(),
            status: Status::Stopped,
            pid: None,
            started_at_ms: None,
            exit_code: None,
            error: None,
            commands: vec![],
            run_id: None,
        });
        if let Some(existing) = status_entry
            .commands
            .iter_mut()
            .find(|c| c.name == cmd_status.name)
        {
            *existing = cmd_status;
        } else {
            status_entry.commands.push(cmd_status);
        }

        Ok(())
    }

    fn stop_one_internal(&self, key: &str) {
        let tx = {
            let mut map = self.running.lock();
            map.get_mut(key).and_then(|r| r.stop_tx.take())
        };
        if let Some(tx) = tx {
            let _ = tx.send(());
        }
    }

    // ---- Aggregate status --------------------------------------------------

    fn aggregate_status(&self, svc: &ServiceDef) -> ServiceStatus {
        let running_map = self.running.lock();
        let statuses_map = self.statuses.lock();
        let mut commands = Vec::with_capacity(svc.cmds.len());
        for entry in &svc.cmds {
            let key = process_key(&svc.id, &entry.name);
            let is_running = running_map.contains_key(&key);
            let status = if is_running {
                Status::Running
            } else {
                statuses_map
                    .get(&svc.id)
                    .and_then(|s| s.commands.iter().find(|c| c.name == entry.name))
                    .map(|c| c.status)
                    .unwrap_or(Status::Stopped)
            };
            let (pid, started_at_ms) = if is_running {
                let r = running_map.get(&key).unwrap();
                (Some(r.pid), Some(r.started_at_ms))
            } else {
                (None, None)
            };
            commands.push(CommandStatus {
                name: entry.name.clone(),
                status,
                pid,
                started_at_ms,
                exit_code: None,
                error: None,
            });
        }
        drop(running_map);
        drop(statuses_map);

        let agg = Status::aggregate(&commands.iter().map(|c| c.status).collect::<Vec<_>>());
        let primary = commands.first();
        ServiceStatus {
            id: svc.id.clone(),
            status: agg,
            pid: primary.and_then(|c| c.pid),
            started_at_ms: primary.and_then(|c| c.started_at_ms),
            exit_code: None,
            error: None,
            commands,
            // Inline lookup instead of `self.current_run_id` to avoid
            // re-taking the same lock we just released above.
            run_id: self.run_ids.lock().get(&svc.id).cloned(),
        }
    }

    fn set_status(&self, status: ServiceStatus) {
        self.statuses
            .lock()
            .insert(status.id.clone(), status.clone());
        self.sink.emit_status(&status);
    }
}

// ---- Internals -----------------------------------------------------------

// All parameters here are plumbing for the line-reader task; bundling
// them into a struct just to satisfy the 7-argument lint would trade a
// legitimate warning for a layer of indirection readers have to peel
// back at every call site. Every argument is load-bearing, so allow it.
#[allow(clippy::too_many_arguments)]
fn spawn_line_reader<R>(
    log_key: &str,
    reader: R,
    stream: Stream,
    logs: LogStore,
    sink: Arc<dyn EventSink>,
    svc_id: String,
    cmd_name: String,
    run_id: Option<String>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let key = log_key.to_string();
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            // Clone once per line — the run id is a ~36-byte UUID string,
            // so the allocation is trivial next to the kernel read and the
            // IPC emit we're about to do.
            let line = logs.push(&key, stream, text, run_id.clone());
            sink.emit_log(&svc_id, &cmd_name, &line);
        }
    });
}

struct SuperviseOutcome {
    kind: Outcome,
    exit_code: Option<i32>,
}

enum Outcome {
    Exited,
    Killed,
    Crashed(String),
}

async fn supervise(
    child: &mut Child,
    stop_rx: oneshot::Receiver<()>,
    grace: Duration,
) -> SuperviseOutcome {
    tokio::select! {
        res = child.wait() => match res {
            Ok(status) => SuperviseOutcome { kind: Outcome::Exited, exit_code: status.code() },
            Err(e) => SuperviseOutcome { kind: Outcome::Crashed(e.to_string()), exit_code: None },
        },
        _ = stop_rx => graceful_kill(child, grace).await,
    }
}

#[cfg(unix)]
async fn graceful_kill(child: &mut Child, grace: Duration) -> SuperviseOutcome {
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;

    if let Some(pid) = child.id() {
        let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGTERM);
    }

    match tokio::time::timeout(grace, child.wait()).await {
        Ok(Ok(status)) => SuperviseOutcome {
            kind: Outcome::Killed,
            exit_code: status.code(),
        },
        Ok(Err(e)) => SuperviseOutcome {
            kind: Outcome::Crashed(e.to_string()),
            exit_code: None,
        },
        Err(_) => {
            if let Some(pid) = child.id() {
                let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
            }
            let status = child.wait().await.ok().and_then(|s| s.code());
            SuperviseOutcome {
                kind: Outcome::Killed,
                exit_code: status,
            }
        }
    }
}

#[cfg(not(unix))]
async fn graceful_kill(child: &mut Child, _grace: Duration) -> SuperviseOutcome {
    let _ = child.start_kill();
    match child.wait().await {
        Ok(status) => SuperviseOutcome {
            kind: Outcome::Killed,
            exit_code: status.code(),
        },
        Err(e) => SuperviseOutcome {
            kind: Outcome::Crashed(e.to_string()),
            exit_code: None,
        },
    }
}

/// Wrap a user command in the appropriate shell so familiar syntax works.
fn shell_command(cmd: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), cmd.to_string()])
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        (shell, vec!["-lc".into(), cmd.to_string()])
    }
}
