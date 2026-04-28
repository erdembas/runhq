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

        // Compose the full launch script: pre-command lines + main
        // command, all in a SINGLE shell session. Earlier we ran the
        // pre-command via a separate `Command::status()` call before
        // spawning the main command — which meant `nvm use 14`,
        // `unset NODE_OPTIONS`, `export FOO=bar`, `source .env` and
        // friends mutated a subshell that died before main started,
        // and their effects never reached main. The user's mental
        // model is "I wrote setup steps, then the real command, in
        // order, in one terminal" — so that's what we deliver.
        //
        // `set -e` makes any pre-command line that exits non-zero
        // abort the whole script before main runs. Without it, a
        // failing `nvm use 14` would silently fall through to
        // `npm start`, which would then run with the wrong toolchain
        // and produce a baffling stack trace far from the actual
        // cause. With `set -e` the user sees the failing line's exit
        // code surface directly via the supervisor's `[exited code N]`
        // closer.
        //
        // `wrap_with_path_override` then prefixes a final `export
        // PATH=…` so the user-configured PATH override wins against
        // dotfile-sourced version managers (nvm, fnm, asdf…). Keeping
        // the override outside the user's pre-command means even an
        // empty pre-command still benefits from it.
        let composed = compose_launch_script(svc.pre_command.as_deref(), &entry.cmd);
        let user_cmd = wrap_with_path_override(&composed, svc.path_override.as_deref());
        let (program, args) = shell_command(&user_cmd);
        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(&svc.cwd)
            // We pipe stdin (and never write to it) instead of pointing it
            // at /dev/null because a surprising number of dev servers
            // exit cleanly the moment they see stdin EOF — most famously
            // create-react-app / react-app-rewired, whose `start.js`
            // does:
            //
            //     process.stdin.on('end', () => { devServer.close(); process.exit(); });
            //     process.stdin.resume();
            //
            // With `Stdio::null()` Linux/macOS hand the child a fd
            // pointed at /dev/null, `resume()` reads it, gets immediate
            // EOF, fires `'end'`, and the dev server exits 0 the very
            // instant after printing "Starting the development
            // server…". RunHQ users see a phantom green "exited code 0"
            // and assume their config is broken, when really we starved
            // the child of an open stdin handle.
            //
            // `Stdio::piped()` gives the child a pipe whose writer end
            // we keep alive for the full lifetime of the supervised run.
            //
            // SUBTLE: just configuring `Stdio::piped()` is NOT enough.
            // Tokio's `Child::wait()` is documented to close the child's
            // stdin handle before awaiting (deliberate deadlock-avoidance:
            // a child blocked on stdin while the parent blocks on `wait()`
            // would deadlock both). For us that "helpful" behaviour is a
            // footgun — the closed pipe surfaces as EOF on the child side
            // and CRA's `process.stdin.on('end', …)` listener fires
            // `process.exit()` a heartbeat after "Starting the development
            // server…". To dodge that, we `child.stdin.take()` immediately
            // after spawn and park the writer end inside the supervise
            // task (see `stdin_keepalive` below). With `child.stdin == None`
            // by the time `wait()` runs, Tokio has nothing to close, and
            // the writer end stays open for the full run.
            //
            // Reads on the child side block indefinitely, exactly like a
            // real terminal that nobody's typing into. Tools that actually
            // want interactive input still see "no TTY" and degrade
            // gracefully; tools that just listen for stdin-end never get
            // the false EOF.
            //
            // Pre-commands below stay on `Stdio::null()` deliberately:
            // they're short-lived `status()` calls where we *want* EOF
            // so anything reading stdin returns immediately instead of
            // hanging RunHQ startup.
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped())
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

        // One-line banner so users can confirm at a glance that their
        // pre-command lines are being included in the launch script.
        // We don't echo the full text (already shown in the editor and
        // can be many lines long) — just a count, mirroring the old
        // "succeeded (N lines)" format users were accustomed to.
        // Failures no longer get a dedicated banner: if `set -e` aborts
        // the script on a failing pre-command line, the supervisor's
        // standard `[exited code N]` closer carries the signal, and
        // the failing line's own stderr is right there in the log.
        if let Some(pre) = &svc.pre_command {
            let pre_trimmed = pre.trim();
            if !pre_trimmed.is_empty() {
                let line_count = pre_trimmed.lines().filter(|l| !l.trim().is_empty()).count();
                let summary = if line_count <= 1 {
                    pre_trimmed.to_string()
                } else {
                    format!("({line_count} lines)")
                };
                let line = self.logs.push(
                    &log_key,
                    Stream::System,
                    format!("ℹ pre-command attached: {summary}"),
                    run_id.clone(),
                );
                self.sink.emit_log(&svc.id, &entry.name, &line);
            }
        }

        // Resolved-environment diagnostic. Only fires when the user has
        // configured a `path_override`, because that's the case where
        // "which interpreter am I actually going to find on PATH?" is a
        // first-class debugging question. Quietly skipped otherwise so
        // ordinary services don't pay an extra ~30ms for noise nobody
        // asked for.
        //
        // Why this banner exists: PATH overrides are *layered* on top of
        // the user's login shell init, which on macOS routinely runs
        // `path_helper`, `nvm`, `fnm`, `asdf`, `pyenv`, and assorted
        // dotfile snippets that all rewrite PATH from scratch. Even
        // when the override is correctly wrapped via `export PATH=…;
        // <cmd>`, a missing/non-executable binary inside the override
        // directory will silently fall through to whatever the next
        // PATH entry resolves to — and the user will see "but I set
        // node 14!" with no obvious explanation. Logging the actually-
        // resolved PATH head + `command -v node` makes the gap visible
        // the first time a service is started.
        //
        // The probe runs the same wrap_with_path_override that the
        // main command does, so it observes precisely the PATH the
        // child process will see, not a parent-process approximation.
        if let Some(path_extra) = &svc.path_override {
            if !path_extra.trim().is_empty() {
                // ${PATH%%:*} = first PATH entry. Plain POSIX, works
                // in zsh/bash/dash. `command -v` is more portable than
                // `which` (it's a shell builtin and always available).
                // We probe `node` specifically because it's the most
                // common reason users reach for path_override; if the
                // service uses a different runtime it'll still show
                // PATH head, which is enough to diagnose 99% of
                // override misses.
                let probe_script = "printf 'PATH head=%s\\n' \"${PATH%%:*}\"; \
                    if command -v node >/dev/null 2>&1; then \
                        printf 'node=%s (%s)\\n' \"$(command -v node)\" \"$(node --version 2>/dev/null || echo unknown)\"; \
                    fi";
                let probe_wrapped =
                    wrap_with_path_override(probe_script, svc.path_override.as_deref());
                let (probe_prog, probe_args) = shell_command(&probe_wrapped);
                let mut probe_cmd = Command::new(&probe_prog);
                probe_cmd
                    .args(&probe_args)
                    .current_dir(&svc.cwd)
                    .stdin(Stdio::null());
                let current = std::env::var("PATH").unwrap_or_default();
                probe_cmd.env("PATH", format!("{}:{}", path_extra.trim(), current));
                if let Ok(out) = probe_cmd.output().await {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for raw in stdout.lines() {
                        let trimmed = raw.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let line = self.logs.push(
                            &log_key,
                            Stream::System,
                            format!("ℹ env: {trimmed}"),
                            run_id.clone(),
                        );
                        self.sink.emit_log(&svc.id, &entry.name, &line);
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
        // Detach the stdin pipe-writer from `Child` BEFORE we hand the child
        // off to `supervise` / `child.wait()`. Tokio documents that
        // `Child::wait()` "will close the stdin handle to the child process,
        // if any" before awaiting — a deliberate deadlock-avoidance measure
        // that's exactly the wrong default for us. The whole reason we used
        // `Stdio::piped()` (see the long comment above where stdio is
        // configured) was to keep the writer end open so dev servers like
        // create-react-app / react-app-rewired don't see stdin EOF and
        // self-terminate via:
        //
        //     process.stdin.on('end', () => { devServer.close(); process.exit(); });
        //
        // If we leave `child.stdin` populated, Tokio drops it the instant
        // `wait()` is called, the child reads EOF on its stdin, fires the
        // `end` listener, and exits 0 a heartbeat after printing "Starting
        // the development server…". The user sees a phantom green exit
        // and our config tab gets blamed.
        //
        // Taking the handle out *here* and parking it in the supervise task
        // (`_stdin_keepalive` below) means: (a) `child.wait()` finds
        // `stdin: None` and has nothing to close, (b) the OS-level pipe
        // writer stays open for the full lifetime of the supervised run,
        // and (c) it gets dropped naturally — and only — when the child
        // has already exited and the task is unwinding, which is too late
        // to matter.
        let stdin_keepalive = child.stdin.take();

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
            // Hold the stdin pipe writer here for the lifetime of the
            // supervised run. See the comment at the `child.stdin.take()`
            // call site for why this is load-bearing. The leading
            // underscore silences "unused" without disabling drop —
            // dropping the binding only happens after `supervise` returns,
            // i.e. after the child has already exited.
            let _stdin_keepalive = stdin_keepalive;
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

/// Prefix a user command with `export PATH='<override>':"$PATH"` so the
/// override wins against version managers (nvm, fnm, asdf…) that prepend
/// their own toolchain to `$PATH` from `.zshrc` / `.bashrc` during the
/// login-shell init that runs before the user's command.
///
/// We deliberately do NOT use `exec` to chain into the user's command:
/// `entry.cmd` is a free-form shell string and frequently contains `&&`,
/// `||`, `;`, pipes, or backgrounded jobs (`pnpm dev && tail -f log` is the
/// example called out in `process.rs` design docs). `exec` only accepts a
/// single program followed by args, so wrapping it that way would silently
/// break those forms. Plain `;` separation keeps the existing subshell
/// model intact.
///
/// Single-quoting the override path makes spaces, `$`, `"`, and other
/// metacharacters inert. Embedded single quotes are escaped via the
/// classic `'\''` close-escape-open pattern so a path like
/// `/Users/me/'weird'/bin` still produces a syntactically valid script.
///
/// On Windows we leave the command untouched: `cmd.exe` doesn't read
/// dotfiles in the same way, the env-level `cmd.env("PATH", …)` we already
/// set is sufficient, and `cmd /C` doesn't have a clean equivalent of
/// POSIX `export … ;` semantics worth bending the abstraction for.
/// Compose the user's pre-command lines and main command into a single
/// shell script that runs in ONE subshell. Lines from `pre_command`
/// run first, then the main command, all sharing the same env — so
/// `nvm use 14`, `unset NODE_OPTIONS`, `source .env`, `export FOO=bar`
/// in pre-command actually reach the main command.
///
/// `set -e` is the safety net: any non-zero exit from a pre-command
/// line aborts the script before main runs. This matches the user's
/// mental model — if `nvm use 14` failed, you don't want `npm start`
/// to silently run on the wrong toolchain. Without `set -e`, pre-
/// command failures would fall through and surface as confusing,
/// far-from-cause errors in main's output.
///
/// We deliberately do NOT use `exec` to launch the main command at the
/// end of the script. `exec` only accepts a single program + args and
/// would silently break compound forms like `pnpm dev && tail -f log`,
/// `cmd1 || cmd2`, pipes, or backgrounded jobs — all of which RunHQ
/// design docs explicitly support. Plain trailing-line execution keeps
/// the existing free-form shell semantics intact.
///
/// When the user has no pre-command (or it's all whitespace) we return
/// the main command verbatim — no `set -e` prelude — so the empty case
/// stays bit-identical to the pre-feature behaviour and we don't
/// mysteriously start aborting on errors users were used to ignoring.
fn compose_launch_script(pre_command: Option<&str>, main_cmd: &str) -> String {
    let pre = pre_command.map(str::trim).filter(|s| !s.is_empty());
    match pre {
        Some(pre) => format!("set -e\n{pre}\nset +e\n{main_cmd}"),
        None => main_cmd.to_string(),
    }
}

fn wrap_with_path_override(cmd: &str, path_override: Option<&str>) -> String {
    if cfg!(windows) {
        return cmd.to_string();
    }
    match path_override {
        Some(extra) => {
            let trimmed = extra.trim();
            if trimmed.is_empty() {
                cmd.to_string()
            } else {
                let escaped = trimmed.replace('\'', "'\\''");
                format!("export PATH='{escaped}':\"$PATH\"; {cmd}")
            }
        }
        None => cmd.to_string(),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn wrap_no_override_passes_command_through() {
        assert_eq!(wrap_with_path_override("npm start", None), "npm start");
    }

    #[test]
    fn wrap_empty_override_passes_command_through() {
        assert_eq!(wrap_with_path_override("npm start", Some("")), "npm start");
        assert_eq!(
            wrap_with_path_override("npm start", Some("   ")),
            "npm start"
        );
    }

    #[test]
    fn wrap_simple_override_prepends_export() {
        let out = wrap_with_path_override(
            "react-app-rewired start",
            Some("/Users/me/node-v14.21.3/bin"),
        );
        assert_eq!(
            out,
            "export PATH='/Users/me/node-v14.21.3/bin':\"$PATH\"; react-app-rewired start"
        );
    }

    #[test]
    fn wrap_preserves_shell_compound_operators() {
        // Free-form user commands routinely chain with `&&`, `||`, `;`,
        // pipes, and backgrounded jobs. Wrapping must keep them intact.
        let out = wrap_with_path_override("pnpm dev && tail -f foo.log", Some("/opt/node/bin"));
        assert!(out.ends_with("pnpm dev && tail -f foo.log"));
        assert!(out.starts_with("export PATH='/opt/node/bin':\"$PATH\";"));
    }

    #[test]
    fn wrap_escapes_embedded_single_quotes_in_path() {
        // Pathological but legal: a directory name with a literal `'`.
        // Must produce a script that any POSIX shell parses cleanly.
        let out = wrap_with_path_override("node -v", Some("/Users/me/'weird'/bin"));
        // Classic close-escape-open trick: `'…'\''…'`.
        assert_eq!(
            out,
            "export PATH='/Users/me/'\\''weird'\\''/bin':\"$PATH\"; node -v"
        );
    }

    #[test]
    fn wrap_trims_surrounding_whitespace_in_override() {
        let out = wrap_with_path_override("ls", Some("  /opt/bin  "));
        assert_eq!(out, "export PATH='/opt/bin':\"$PATH\"; ls");
    }

    // -------- compose_launch_script --------

    #[test]
    fn compose_no_pre_returns_main_unchanged() {
        // Empty/whitespace/None pre-commands all leave the main command
        // bit-identical to the legacy behaviour. This is load-bearing —
        // existing services without a pre-command must not start
        // hitting `set -e` semantics they didn't ask for.
        assert_eq!(compose_launch_script(None, "npm start"), "npm start");
        assert_eq!(compose_launch_script(Some(""), "npm start"), "npm start");
        assert_eq!(
            compose_launch_script(Some("   \n  "), "npm start"),
            "npm start"
        );
    }

    #[test]
    fn compose_pre_runs_in_same_session_with_errexit_around_setup() {
        // The whole point of this fix: the user's pre-command lines and
        // their main command live in ONE shell script. `set -e` brackets
        // only the pre-command region — main runs with errexit OFF so
        // its own internal compound shell semantics (&&, ||, pipes,
        // background jobs) keep working unchanged.
        let out = compose_launch_script(Some("nvm use 14\nunset NODE_OPTIONS"), "npm start");
        assert_eq!(
            out,
            "set -e\nnvm use 14\nunset NODE_OPTIONS\nset +e\nnpm start"
        );
    }

    #[test]
    fn compose_preserves_main_command_compound_operators() {
        // The composed script must not break `&&`/`||`/`;`/pipes in
        // either the pre-command or main. They flow through verbatim.
        let out = compose_launch_script(
            Some("export FOO=bar\nsource .env"),
            "pnpm dev && tail -f foo.log",
        );
        assert!(out.starts_with("set -e\nexport FOO=bar\nsource .env\nset +e\n"));
        assert!(out.ends_with("pnpm dev && tail -f foo.log"));
    }

    #[test]
    fn compose_trims_pre_block_but_keeps_internal_blank_lines() {
        // Leading/trailing whitespace in the pre-command field is just
        // textarea slop — strip it. But don't touch internal blank
        // lines (a user might use them for visual grouping in long
        // setup scripts; shell ignores blank lines anyway).
        let out = compose_launch_script(Some("\n\nexport A=1\n\nexport B=2\n\n"), "main");
        assert_eq!(out, "set -e\nexport A=1\n\nexport B=2\nset +e\nmain");
    }
}
