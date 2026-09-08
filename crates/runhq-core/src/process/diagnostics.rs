use std::process::Stdio;
use std::sync::Arc;

use tokio::process::Command;

use crate::events::EventSink;
use crate::logs::{LogStore, Stream};
use crate::state::{CommandEntry, ServiceDef};

use super::shell::{shell_command, wrap_with_path_override};

pub(super) async fn emit_launch_diagnostics(
    svc: &ServiceDef,
    entry: &CommandEntry,
    log_key: &str,
    run_id: Option<String>,
    logs: LogStore,
    sink: Arc<dyn EventSink>,
) {
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
            let line = logs.push_with_detail(
                log_key,
                Stream::System,
                format!("ℹ pre-command attached: {summary}"),
                run_id.clone(),
                Some(pre_trimmed.to_string()),
            );
            sink.emit_log(&svc.id, &entry.name, &line);
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
            let probe_wrapped = wrap_with_path_override(probe_script, svc.path_override.as_deref());
            let (probe_prog, probe_args) = shell_command(&probe_wrapped);
            let mut probe_cmd = Command::new(&probe_prog);
            probe_cmd
                .args(&probe_args)
                .current_dir(&svc.cwd)
                .stdin(Stdio::null());
            crate::hide_console::tokio_command(&mut probe_cmd);
            let current = std::env::var("PATH").unwrap_or_default();
            probe_cmd.env("PATH", format!("{}:{}", path_extra.trim(), current));
            if let Ok(out) = probe_cmd.output().await {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for raw in stdout.lines() {
                    let trimmed = raw.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let line = logs.push(
                        log_key,
                        Stream::System,
                        format!("ℹ env: {trimmed}"),
                        run_id.clone(),
                    );
                    sink.emit_log(&svc.id, &entry.name, &line);
                }
            }
        }
    }
}
