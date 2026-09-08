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
    crate::hide_console::tokio_command(&mut cmd);

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
