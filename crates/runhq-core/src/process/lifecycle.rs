use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::logs::Stream;
use crate::process_group::JobObject;
use crate::state::{CommandEntry, ServiceDef};

use super::diagnostics::emit_launch_diagnostics;
use super::line_reader::spawn_line_reader;
use super::shell::{compose_launch_script, shell_command, wrap_with_path_override};
use super::stdio::configure_child_stdio;
use super::supervision::{supervise, Outcome};
use super::supervisor::Supervisor;
use super::types::{process_key, CommandStatus, Running, ServiceStatus, Status};

impl Supervisor {
    // ---- Single command lifecycle ------------------------------------------

    pub(super) async fn start_one(&self, svc: &ServiceDef, entry: &CommandEntry) -> AppResult<()> {
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
        cmd.args(args).current_dir(&svc.cwd);
        configure_child_stdio(&mut cmd);

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

        emit_launch_diagnostics(
            svc,
            entry,
            &log_key,
            run_id.clone(),
            self.logs.clone(),
            self.sink.clone(),
        )
        .await;

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

        // Windows: pin the freshly-spawned shell into a Job Object that
        // tree-kills on close. Best-effort — if attachment fails (race
        // with an instant-exit child, EDR blocking OpenProcess), we log
        // and proceed without containment rather than refusing to start
        // the service. Same outcome as before this fix existed; only the
        // tree-kill on stop is degraded. Held in `Running._job` so the
        // job stays open for the entire run lifetime.
        //
        // On non-Windows targets `JobObject::attach_kill_on_close` is a
        // no-op shim that returns `Ok(JobObject)` — kept unconditional
        // to avoid `cfg`-sprawl at the spawn site. Unix tree-kill is
        // delivered via `setsid()` + `killpg()` in `graceful_kill`.
        let job = if pid != 0 {
            #[cfg(windows)]
            {
                match JobObject::attach_kill_on_close(pid) {
                    Ok(j) => Some(j),
                    Err(e) => {
                        tracing::warn!(
                            "failed to attach Job Object for {}::{} (pid {}): {} \
                             — process tree kill on stop will be degraded",
                            svc.id,
                            entry.name,
                            pid,
                            e
                        );
                        None
                    }
                }
            }
            #[cfg(not(windows))]
            {
                JobObject::attach_kill_on_close(pid).ok()
            }
        } else {
            None
        };

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
                _job: job,
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
}
