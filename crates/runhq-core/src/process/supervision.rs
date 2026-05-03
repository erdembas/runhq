use std::time::Duration;

use tokio::process::Child;
use tokio::sync::oneshot;

pub(super) struct SuperviseOutcome {
    pub(super) kind: Outcome,
    pub(super) exit_code: Option<i32>,
}

pub(super) enum Outcome {
    Exited,
    Killed,
    Crashed(String),
}

pub(super) async fn supervise(
    child: &mut Child,
    stop_rx: oneshot::Receiver<()>,
    grace: Duration,
) -> SuperviseOutcome {
    tokio::select! {
        res = child.wait() => match res {
            Ok(status) => SuperviseOutcome { kind: Outcome::Exited, exit_code: status.code() },
            Err(e) => SuperviseOutcome { kind: Outcome::Crashed(e.to_string()), exit_code: None },
        },
        _ = stop_rx => graceful_kill(child, grace).await,
    }
}

#[cfg(unix)]
async fn graceful_kill(child: &mut Child, grace: Duration) -> SuperviseOutcome {
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;

    if let Some(pid) = child.id() {
        let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGTERM);
    }

    match tokio::time::timeout(grace, child.wait()).await {
        Ok(Ok(status)) => SuperviseOutcome {
            kind: Outcome::Killed,
            exit_code: status.code(),
        },
        Ok(Err(e)) => SuperviseOutcome {
            kind: Outcome::Crashed(e.to_string()),
            exit_code: None,
        },
        Err(_) => {
            if let Some(pid) = child.id() {
                let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
            }
            let status = child.wait().await.ok().and_then(|s| s.code());
            SuperviseOutcome {
                kind: Outcome::Killed,
                exit_code: status,
            }
        }
    }
}

#[cfg(not(unix))]
async fn graceful_kill(child: &mut Child, _grace: Duration) -> SuperviseOutcome {
    let _ = child.start_kill();
    match child.wait().await {
        Ok(status) => SuperviseOutcome {
            kind: Outcome::Killed,
            exit_code: status.code(),
        },
        Err(e) => SuperviseOutcome {
            kind: Outcome::Crashed(e.to_string()),
            exit_code: None,
        },
    }
}
