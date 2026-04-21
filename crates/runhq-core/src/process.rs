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
use crate::resources::ResourceSampler;
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
}

impl Supervisor {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            logs: LogStore::new(),
            running: Arc::new(Mutex::new(HashMap::new())),
            statuses: Arc::new(Mutex::new(HashMap::new())),
        }
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
                for (id, sample) in samples {
                    self.sink.emit_resources(&id, &sample);
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

        {
            let line = self.logs.push(
                &log_key,
                Stream::System,
                format!("▶ starting '{}' in {}", entry.cmd, svc.cwd.display()),
            );
            self.sink.emit_log(&svc.id, &entry.name, &line);
        }

        // Stamp the current commit hash onto the log stream so a reader
        // returning to stale logs can correlate output with the exact code
        // it was produced from. Skipped silently when the cwd is not a repo.
        if let Some(hash) = crate::git::current_commit_short(&svc.cwd) {
            let line = self
                .logs
                .push(&log_key, Stream::System, format!("⎇ commit {hash}"));
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
                        );
                        self.sink.emit_log(&svc.id, &entry.name, &line);
                    }
                    Ok(s) => {
                        let msg = format!(
                            "✗ pre-command exited with code {}: {pre_trimmed}",
                            s.code().unwrap_or(-1)
                        );
                        let line = self.logs.push(&log_key, Stream::System, msg);
                        self.sink.emit_log(&svc.id, &entry.name, &line);
                        return Err(AppError::Other(format!(
                            "pre-command failed for '{}'",
                            entry.name
                        )));
                    }
                    Err(e) => {
                        let msg = format!("✗ pre-command failed: {pre_trimmed} — {e}");
                        let line = self.logs.push(&log_key, Stream::System, msg);
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
                let msg = format!("failed to spawn '{}': {e}", entry.cmd);
                let line = self.logs.push(&log_key, Stream::System, format!("✗ {msg}"));
                self.sink.emit_log(&svc.id, &entry.name, &line);
                return Err(AppError::Other(msg));
            }
        };

        let pid = child.id().unwrap_or(0);
        let started_at_ms = chrono::Utc::now().timestamp_millis();

        {
            let line = self.logs.push(
                &log_key,
                Stream::System,
                format!("▶ started '{}' (pid {pid})", entry.cmd),
            );
            self.sink.emit_log(&svc.id, &entry.name, &line);
        }

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
        let grace = Duration::from_millis(svc.grace_ms);

        let task = tokio::spawn(async move {
            let outcome = supervise(&mut child, stop_rx, grace).await;
            let (status, err_msg) = match outcome.kind {
                Outcome::Exited | Outcome::Killed => (Status::Exited, None),
                Outcome::Crashed(e) => (Status::Crashed, Some(e)),
            };

            let text = match outcome.exit_code {
                Some(code) => format!("■ exited (code {code})"),
                None => "■ exited".to_string(),
            };
            let line = task_logs.push(&task_key, Stream::System, text);
            task_sink.emit_log(&task_svc_id, &task_cmd_name, &line);

            task_running_map.lock().remove(&task_key);

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
                    id: task_svc_id,
                    status: Status::Stopped,
                    pid: None,
                    started_at_ms: None,
                    exit_code: None,
                    error: None,
                    commands: vec![],
                });
            if let Some(existing) = entry.commands.iter_mut().find(|c| c.name == final_cmd.name) {
                *existing = final_cmd;
            } else {
                entry.commands.push(final_cmd);
            }
            let svc_id = entry.id.clone();
            let agg =
                Status::aggregate(&entry.commands.iter().map(|c| c.status).collect::<Vec<_>>());
            entry.status = agg;
            task_sink.emit_status(&*entry);
            // Ensure map has the updated entry
            let _ = entry;
            let _ = svc_id;
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

fn spawn_line_reader<R>(
    log_key: &str,
    reader: R,
    stream: Stream,
    logs: LogStore,
    sink: Arc<dyn EventSink>,
    svc_id: String,
    cmd_name: String,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let key = log_key.to_string();
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(text)) = lines.next_line().await {
            let line = logs.push(&key, stream, text);
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
