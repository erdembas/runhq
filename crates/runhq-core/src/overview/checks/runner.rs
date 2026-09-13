use std::path::Path;
use std::time::Duration;

use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

// ---- Subprocess runner with real timeout ----------------------------------

/// Spawn an external command and collect its stdout, enforcing a hard
/// timeout. If the deadline passes, the child is killed and we return
/// `None`. `stderr` is discarded — these CLIs emit progress chatter that
/// we don't need and which would crowd the buffer.
pub(super) async fn run_timed(
    program: &str,
    args: &[&str],
    cwd: &Path,
    deadline: Duration,
) -> Option<Vec<u8>> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args)
        .current_dir(cwd)
        // Running git inside a service cwd inherits the parent's GIT_*
        // env when launched via `cargo run`; stripping them here stops
        // `npm audit` from accidentally reading this process's git repo.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    // npm.cmd / cargo.exe are console apps. The dashboard runs
    // `npm outdated` / `cargo audit` in parallel per project; without
    // CREATE_NO_WINDOW each one pops a black terminal.
    crate::hide_console::tokio_command(&mut cmd);

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            // Log loudly: a missing binary on `$PATH` is the #1 cause of
            // "scan completed instantly with all-None results" reports
            // from production users. Surfacing program + cwd + errno
            // turns a silent "0 outdated, 0 vulnerabilities" UI bug into
            // a single grep for the developer.
            tracing::warn!(
                program,
                ?cwd,
                kind = ?err.kind(),
                error = %err,
                "overview command failed to spawn (binary missing on PATH?)"
            );
            return None;
        }
    };

    match timeout(deadline, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            // Many of these commands exit non-zero to signal "work to do"
            // rather than failure — `npm outdated` returns 1 when packages
            // are outdated. Use stdout presence as the real success
            // signal.
            if output.stdout.is_empty() && !output.status.success() {
                None
            } else {
                Some(output.stdout)
            }
        }
        Ok(Err(_)) => None,
        Err(_) => {
            // Timed out. `wait_with_output` already consumed the child; we
            // rely on `kill_on_drop` to tear it down when the owning Child
            // is dropped (which happens as `output` goes out of scope via
            // the `?` above, or here as `cmd` is dropped).
            tracing::warn!(program, ?cwd, ?deadline, "overview command timed out");
            None
        }
    }
}
