use std::process::Stdio;

use tokio::process::Command;

/// Keep child stdin open for the run lifetime while still streaming stdout
/// and stderr. Some dev servers exit as soon as stdin reaches EOF; using a
/// pipe and moving the writer out of `Child` later avoids that false exit.
pub(super) fn configure_child_stdio(cmd: &mut Command) {
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped())
        .kill_on_drop(true);
}
