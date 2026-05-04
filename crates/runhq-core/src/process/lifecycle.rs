use std::time::Duration;

use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::logs::Stream;
use crate::state::{CommandEntry, ServiceDef};

use super::diagnostics::emit_launch_diagnostics;
use super::pty::{spawn_pty_output_reader, spawn_service_pty, supervise_pty, Outcome, ServicePty};
use super::shell::{compose_launch_script, wrap_with_path_override};
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

        emit_launch_diagnostics(
            svc,
            entry,
            &log_key,
            run_id.clone(),
            self.logs.clone(),
            self.sink.clone(),
        )
        .await;

        let (cols, rows) = self.pty_size_for(&key);
        let pty = match spawn_service_pty(svc, &user_cmd, cols, rows) {
            Ok(pty) => pty,
            Err(e) => {
                let msg = format!("failed to spawn: {e}");
                let line = self
                    .logs
                    .push(&log_key, Stream::System, msg.clone(), run_id.clone());
                self.sink.emit_log(&svc.id, &entry.name, &line);
                return Err(AppError::Other(msg));
            }
        };

        let ServicePty {
            pid,
            process_group,
            child,
            killer,
            reader,
            writer,
            handle,
            job,
        } = pty;
        let started_at_ms = chrono::Utc::now().timestamp_millis();

        spawn_pty_output_reader(
            &log_key,
            reader,
            self.logs.clone(),
            self.sink.clone(),
            svc.id.clone(),
            entry.name.clone(),
            run_id.clone(),
        );

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
            // Keep the PTY writer alive while the child runs. The log view is
            // readonly, but some dev servers still exit when stdin hits EOF.
            let _pty_writer = writer;
            let outcome = supervise_pty(child, killer, process_group, stop_rx, grace).await;
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
                pty: Some(handle),
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
