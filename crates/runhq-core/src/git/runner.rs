use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::error::{AppError, AppResult};

use super::status::is_repo;
use super::types::CommitInfo;

// ---- internals ------------------------------------------------------------

/// Upper bound for network-touching operations (fetch, pull). Without this a
/// stalled remote (SSH hang, VPN drop) would leave the UI spinner forever.
pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) fn require_repo(cwd: &Path) -> AppResult<()> {
    if is_repo(cwd) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "not a git repository: {}",
            cwd.display()
        )))
    }
}

pub(super) fn read_last_commit(cwd: &Path) -> Option<CommitInfo> {
    // Use \x1f (unit separator) as the field separator so commit messages
    // containing newlines or tabs don't break parsing.
    let (ok, out, _) = run_git(
        cwd,
        &[
            "log",
            "-1",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%s%x1f%ct",
        ],
    )
    .ok()?;
    if !ok {
        return None;
    }
    let mut parts = out.split('\x1f');
    Some(CommitInfo {
        hash_full: parts.next()?.trim().to_string(),
        hash_short: parts.next()?.trim().to_string(),
        author: parts.next()?.trim().to_string(),
        email: parts.next()?.trim().to_string(),
        subject: parts.next()?.trim().to_string(),
        timestamp: parts.next()?.trim().parse().ok()?,
    })
}

/// Environment variables that redirect git to a specific repo/index. If the
/// parent process is itself running inside a git operation (a git hook, a
/// rebase, `git commit` invoking this binary, etc.) these will be set and
/// would cause every git call we make here to target the parent's repo
/// rather than our `cwd`. Always clear them for a clean isolation boundary.
const LEAKY_GIT_ENV: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_INTERNAL_GETTEXT_TEST_FALLBACKS",
];

fn configure_git_cmd(cmd: &mut Command, cwd: &Path) {
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Keep git's own output stable regardless of the user's locale.
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    for var in LEAKY_GIT_ENV {
        cmd.env_remove(var);
    }
    // git.exe is a console-subsystem binary. Without CREATE_NO_WINDOW,
    // the 15–30s git-status poller flashes a cmd window per project.
    crate::hide_console::std_command(cmd);
}

/// Run `git` in `cwd`. Returns `(success, stdout, stderr)`.
///
/// We deliberately swallow invocation failures (git not installed) into an
/// `Err` so callers can surface a clean "git unavailable" message instead of
/// a raw `std::io::Error`.
pub(super) fn run_git(cwd: &Path, args: &[&str]) -> AppResult<(bool, String, String)> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    configure_git_cmd(&mut cmd, cwd);
    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("failed to invoke git: {e}")))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

#[cfg(unix)]
pub(super) fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> AppResult<(bool, String, String)> {
    use std::io::Read;

    let mut cmd = Command::new("git");
    cmd.args(args);
    configure_git_cmd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to invoke git: {e}")))?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut stdout);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut stderr);
                }
                return Ok((status.success(), stdout, stderr));
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err(AppError::Other(format!(
                        "git {} timed out after {:?}",
                        args.join(" "),
                        timeout
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(AppError::Other(format!("git wait failed: {e}"))),
        }
    }
}

#[cfg(not(unix))]
pub(super) fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    _timeout: Duration,
) -> AppResult<(bool, String, String)> {
    // Windows timeout support would need a job object or a watcher thread;
    // we fall back to a plain blocking run since the UI already surfaces
    // long-running operations via a spinner.
    run_git(cwd, args)
}
