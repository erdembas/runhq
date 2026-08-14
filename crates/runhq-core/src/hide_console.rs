//! Hide helper-process consoles on Windows.
//!
//! A windowed Tauri app that spawns a console-subsystem binary (`git.exe`,
//! `npm.cmd`, `cmd.exe`, …) without `CREATE_NO_WINDOW` flashes a black
//! terminal for the lifetime of that child. RunHQ polls `git status` on
//! every project every few seconds and shells out to `npm outdated` /
//! `cargo audit` during dependency scans, so the flash is constant, not
//! a one-off.
//!
//! Apply this to **headless** helpers whose stdout/stderr we already
//! pipe. Do **not** apply it to PTY-backed service shells — those need
//! a console attached to ConPTY so `dotnet run` / `npm run dev` can
//! stream into the in-app terminal.

/// `CREATE_NO_WINDOW` — see
/// <https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags>.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Suppress the console window of a [`std::process::Command`] helper.
/// No-op on Unix.
pub fn std_command(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Suppress the console window of a [`tokio::process::Command`] helper.
/// No-op on Unix.
pub fn tokio_command(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn hidden_cmd_still_captures_stdout() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "echo hidden-ok"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        std_command(&mut cmd);
        let out = cmd.output().expect("cmd.exe should spawn");
        assert!(out.status.success());
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            stdout.contains("hidden-ok"),
            "CREATE_NO_WINDOW must not swallow piped stdout, got {stdout:?}"
        );
    }
}
