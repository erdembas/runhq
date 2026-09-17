use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::{process_group::JobObject, AppError, AppResult};

pub(super) fn executable(name: &str) -> Option<PathBuf> {
    super::discovery::resolve(name)
        .filter(|found| found.runnable)
        .map(|found| found.path)
}

pub(super) async fn node_executable() -> AppResult<PathBuf> {
    let node = executable("node").ok_or_else(|| {
        AppError::other(
            "Node.js 22 or newer is required. Install Node.js, then refresh agent detection.",
        )
    })?;
    let reported = version(&node)
        .await
        .map_err(|error| AppError::other(format!("Node.js could not be checked: {error}")))?;
    let major = reported
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    if !major.is_some_and(|major| major >= 22) {
        return Err(AppError::other(
            "Node.js 22 or newer is required; the detected Node.js version is unsupported.",
        ));
    }
    Ok(node)
}

pub(super) struct OwnedProcess {
    pub child: Child,
    #[cfg(unix)]
    pid: Option<u32>,
    _job: Option<JobObject>,
}
impl OwnedProcess {
    pub fn spawn(mut cmd: Command) -> AppResult<Self> {
        cmd.kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let child = cmd.spawn()?;
        let pid = child.id();
        let job = pid.and_then(|p| JobObject::attach_kill_on_close(p).ok());
        Ok(Self {
            child,
            #[cfg(unix)]
            pid,
            _job: job,
        })
    }
    pub fn stop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
        let _ = self.child.start_kill();
    }
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn probe_output(
    path: &Path,
    args: &[String],
    limit: u64,
    timeout: Duration,
    label: &str,
) -> AppResult<String> {
    let mut cmd = Command::new(path);
    cmd.args(args);
    if let Some(path) = super::agent_command_path(path) {
        cmd.env("PATH", path);
    }
    let mut proc = OwnedProcess::spawn(cmd)?;
    // Probes have no input. In particular, wrappers must see EOF rather than wait forever.
    drop(proc.child.stdin.take());
    let mut stdout = proc
        .child
        .stdout
        .take()
        .ok_or_else(|| AppError::other("Missing CLI probe output"))?
        .take(limit + 1);
    tokio::time::timeout(timeout, async {
        let mut text = String::new();
        stdout.read_to_string(&mut text).await?;
        if text.len() as u64 > limit {
            return Err(AppError::other(format!("{label} produced too much output")));
        }
        let status = proc.child.wait().await?;
        if !status.success() {
            return Err(AppError::other(format!("{label} failed ({status})")));
        }
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|_| AppError::other(format!("{label} timed out")))?
}

pub(super) async fn version(path: &Path) -> AppResult<String> {
    probe_output(
        path,
        &["--version".into()],
        4096,
        Duration::from_secs(5),
        "CLI version check",
    )
    .await
}

pub(super) async fn cursor_acp(path: &Path, args: &[String]) -> AppResult<()> {
    // --help prevents an older Cursor version from treating "acp" as a chat prompt.
    let mut args = args.to_vec();
    args.push("--help".into());
    let help = probe_output(
        path,
        &args,
        32768,
        Duration::from_secs(5),
        "Cursor ACP compatibility check",
    )
    .await?;
    if !cursor_help_advertises_acp(&help) {
        return Err(AppError::other("This Cursor CLI does not advertise ACP support. Run agent update, then agent login and refresh."));
    }
    Ok(())
}

fn cursor_help_advertises_acp(text: &str) -> bool {
    text.lines().any(|line| {
        let line = line.trim();
        line.split_whitespace().next() == Some("acp")
            || (line.to_ascii_lowercase().starts_with("usage:")
                && line.split_whitespace().any(|word| word == "acp"))
    })
}

// Using take bounds allocations even if a malfunctioning bridge never emits a newline.
pub(super) async fn frame(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> AppResult<Option<serde_json::Value>> {
    let mut line = String::new();
    let n = reader
        .take(2 * 1024 * 1024 + 1)
        .read_line(&mut line)
        .await?;
    if n == 0 {
        return Ok(None);
    }
    if n > 2 * 1024 * 1024 {
        return Err(AppError::other("Agent event exceeds 2 MiB"));
    }
    Ok(Some(serde_json::from_str(&line)?))
}

#[cfg(test)]
mod tests {
    use super::cursor_help_advertises_acp;

    #[test]
    fn cursor_requires_an_advertised_command_before_starting_acp() {
        assert!(cursor_help_advertises_acp("Usage: agent acp [options]"));
        assert!(cursor_help_advertises_acp(
            "Commands:\n  acp  Start ACP server\n"
        ));
        assert!(!cursor_help_advertises_acp(
            "Usage: agent [prompt...]\nCommands:\n  login\n  update\n"
        ));
        assert!(!cursor_help_advertises_acp("Use acp for integrations"));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn cli_probes_close_stdin_and_bound_failures_output_and_duration() {
        use super::{probe_output, version};
        use std::{
            os::unix::fs::PermissionsExt,
            time::{Duration, Instant},
        };
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("cli");
        std::fs::write(&script, "#!/bin/sh\ncat >/dev/null\necho 1.2.3\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(version(&script).await.unwrap(), "1.2.3");
        std::fs::write(&script, "#!/bin/sh\nexit 7\n").unwrap();
        assert!(version(&script)
            .await
            .unwrap_err()
            .to_string()
            .contains("exit status: 7"));
        std::fs::write(&script, "#!/bin/sh\nprintf 1234567890\n").unwrap();
        assert!(
            probe_output(&script, &[], 4, Duration::from_secs(1), "Fixture")
                .await
                .unwrap_err()
                .to_string()
                .contains("too much output")
        );
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        let start = Instant::now();
        assert!(
            probe_output(&script, &[], 4096, Duration::from_millis(80), "Fixture")
                .await
                .unwrap_err()
                .to_string()
                .contains("timed out")
        );
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
