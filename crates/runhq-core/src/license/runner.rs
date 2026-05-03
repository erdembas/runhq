use std::path::Path;

use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

const SCAN_TIMEOUT: Duration = Duration::from_secs(30);

// ---- Subprocess runner ----------------------------------------------------

pub(super) async fn run_timed(program: &str, args: &[&str], cwd: &Path) -> Option<Vec<u8>> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    // Suppress the console window flash on Windows. Without this, a
    // license scan would briefly pop a black `cmd.exe`-style window
    // every time the user clicked Rescan — jarring inside a windowed
    // Tauri shell. CREATE_NO_WINDOW = 0x08000000. `tokio::process::
    // Command` exposes `creation_flags` directly on Windows, so we
    // don't need the `std::os::windows::process::CommandExt` import
    // (which clippy flags as unused under -D warnings).
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return None,
    };

    match timeout(SCAN_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            if output.stdout.is_empty() && !output.status.success() {
                None
            } else {
                Some(output.stdout)
            }
        }
        _ => None,
    }
}
