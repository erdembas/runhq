use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::events::EventSink;
use crate::logs::{LogStore, Stream};
use crate::process_group::JobObject;
use crate::state::ServiceDef;

use super::shell::shell_command;

pub(super) const DEFAULT_SERVICE_PTY_ROWS: u16 = 40;
pub(super) const DEFAULT_SERVICE_PTY_COLS: u16 = 120;
const PTY_READ_BUF: usize = 8 * 1024;

pub(super) struct SuperviseOutcome {
    pub(super) kind: Outcome,
    pub(super) exit_code: Option<i32>,
}

pub(super) enum Outcome {
    Exited,
    Killed,
    Crashed(String),
}

pub(super) struct ServicePty {
    pub(super) pid: u32,
    pub(super) process_group: Option<i32>,
    pub(super) child: Box<dyn Child + Send + Sync>,
    pub(super) killer: Box<dyn ChildKiller + Send + Sync>,
    pub(super) reader: Box<dyn Read + Send>,
    pub(super) writer: Box<dyn Write + Send>,
    pub(super) handle: ServicePtyHandle,
    pub(super) job: Option<JobObject>,
}

#[derive(Clone)]
pub(super) struct ServicePtyHandle {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

impl ServicePtyHandle {
    fn new(master: Box<dyn MasterPty + Send>) -> Self {
        Self {
            master: Arc::new(Mutex::new(master)),
        }
    }

    pub(super) fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        let cols = cols.max(20);
        let rows = rows.max(5);
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(AppError::from)
    }
}

pub(super) fn spawn_service_pty(
    svc: &ServiceDef,
    user_cmd: &str,
    cols: u16,
    rows: u16,
) -> AppResult<ServicePty> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: rows.max(5),
        cols: cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let (program, args) = shell_command(user_cmd);
    let mut cmd = CommandBuilder::new(&program);
    cmd.args(args);
    cmd.cwd(svc.cwd.as_os_str());

    // Match the interactive terminal environment closely. Because the command
    // is attached to a real PTY, CLIs can use their normal auto-detection
    // instead of us forcing color through environment variables.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    for (key, value) in &svc.env {
        cmd.env(key, value);
    }

    if let Some(path_extra) = &svc.path_override {
        let extra = path_extra.trim();
        if !extra.is_empty() {
            let current = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{extra}:{current}"));
        }
    }

    let child = pair.slave.spawn_command(cmd)?;
    let killer = child.clone_killer();
    let pid = child.process_id().unwrap_or(0);
    let job = attach_job_object(pid, &svc.id);
    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let process_group = process_group_leader(&*pair.master);
    let handle = ServicePtyHandle::new(pair.master);

    Ok(ServicePty {
        pid,
        process_group,
        child,
        killer,
        reader,
        writer,
        handle,
        job,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_pty_output_reader(
    log_key: &str,
    mut reader: Box<dyn Read + Send>,
    logs: LogStore,
    sink: Arc<dyn EventSink>,
    svc_id: String,
    cmd_name: String,
    run_id: Option<String>,
) {
    let key = log_key.to_string();
    std::thread::spawn(move || {
        let mut read_buf = [0_u8; PTY_READ_BUF];
        let mut decoder = Utf8ChunkDecoder::default();
        loop {
            match reader.read(&mut read_buf) {
                Ok(0) => break,
                Ok(n) => {
                    let Some(text) = decoder.push(&read_buf[..n]) else {
                        continue;
                    };
                    let line = logs.push_raw(&key, Stream::Stdout, text, run_id.clone());
                    sink.emit_log(&svc_id, &cmd_name, &line);
                }
                Err(err) => {
                    tracing::debug!(
                        service_id = %svc_id,
                        command = %cmd_name,
                        "service PTY reader stopped: {err}"
                    );
                    break;
                }
            }
        }

        if let Some(text) = decoder.finish() {
            let line = logs.push_raw(&key, Stream::Stdout, text, run_id.clone());
            sink.emit_log(&svc_id, &cmd_name, &line);
        }
    });
}

#[derive(Default)]
struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    fn push(&mut self, bytes: &[u8]) -> Option<String> {
        self.pending.extend_from_slice(bytes);
        self.drain_valid()
    }

    fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            let text = String::from_utf8_lossy(&self.pending).into_owned();
            self.pending.clear();
            Some(text)
        }
    }

    fn drain_valid(&mut self) -> Option<String> {
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                if text.is_empty() {
                    None
                } else {
                    let text = text.to_string();
                    self.pending.clear();
                    Some(text)
                }
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to == 0 && err.error_len().is_none() {
                    return None;
                }

                let drain_to = if valid_up_to == 0 {
                    err.error_len().unwrap_or(0)
                } else {
                    valid_up_to
                };
                if drain_to == 0 {
                    return None;
                }

                let text = String::from_utf8_lossy(&self.pending[..drain_to]).into_owned();
                self.pending.drain(..drain_to);
                Some(text)
            }
        }
    }
}

pub(super) async fn supervise_pty(
    mut child: Box<dyn Child + Send + Sync>,
    mut killer: Box<dyn ChildKiller + Send + Sync>,
    process_group: Option<i32>,
    stop_rx: oneshot::Receiver<()>,
    grace: Duration,
) -> SuperviseOutcome {
    let mut wait_task = tokio::task::spawn_blocking(move || child.wait());

    tokio::select! {
        res = &mut wait_task => wait_result(res, Outcome::Exited),
        _ = stop_rx => graceful_kill_pty(&mut killer, process_group, &mut wait_task, grace).await,
    }
}

async fn graceful_kill_pty(
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
    process_group: Option<i32>,
    wait_task: &mut tokio::task::JoinHandle<std::io::Result<portable_pty::ExitStatus>>,
    grace: Duration,
) -> SuperviseOutcome {
    terminate_process(process_group, killer, false);

    match tokio::time::timeout(grace, &mut *wait_task).await {
        Ok(res) => wait_result(res, Outcome::Killed),
        Err(_) => {
            terminate_process(process_group, killer, true);
            wait_result(wait_task.await, Outcome::Killed)
        }
    }
}

fn wait_result(
    res: Result<std::io::Result<portable_pty::ExitStatus>, tokio::task::JoinError>,
    kind: Outcome,
) -> SuperviseOutcome {
    match res {
        Ok(Ok(status)) => SuperviseOutcome {
            kind,
            exit_code: exit_code(&status),
        },
        Ok(Err(err)) => SuperviseOutcome {
            kind: Outcome::Crashed(err.to_string()),
            exit_code: None,
        },
        Err(err) => SuperviseOutcome {
            kind: Outcome::Crashed(err.to_string()),
            exit_code: None,
        },
    }
}

fn exit_code(status: &portable_pty::ExitStatus) -> Option<i32> {
    if status.to_string().starts_with("Terminated by ") {
        None
    } else {
        Some(status.exit_code() as i32)
    }
}

fn attach_job_object(pid: u32, service_id: &str) -> Option<JobObject> {
    if pid == 0 {
        return None;
    }

    #[cfg(windows)]
    {
        match JobObject::attach_kill_on_close(pid) {
            Ok(job) => Some(job),
            Err(err) => {
                tracing::warn!(
                    "failed to attach Job Object for {service_id} (pid {pid}): {err} \
                     — process tree kill on stop will be degraded"
                );
                None
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = service_id;
        JobObject::attach_kill_on_close(pid).ok()
    }
}

#[cfg(unix)]
fn process_group_leader(master: &dyn MasterPty) -> Option<i32> {
    master.process_group_leader()
}

#[cfg(not(unix))]
fn process_group_leader(_master: &dyn MasterPty) -> Option<i32> {
    None
}

#[cfg(unix)]
fn signal_process_group(process_group: Option<i32>, signal: nix::sys::signal::Signal) -> bool {
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;

    let Some(pid) = process_group else {
        return false;
    };
    killpg(Pid::from_raw(pid), signal).is_ok()
}

fn terminate_process(
    process_group: Option<i32>,
    killer: &mut Box<dyn ChildKiller + Send + Sync>,
    force: bool,
) {
    #[cfg(unix)]
    {
        let signal = if force {
            nix::sys::signal::Signal::SIGKILL
        } else {
            nix::sys::signal::Signal::SIGTERM
        };
        if signal_process_group(process_group, signal) {
            return;
        }
    }

    let _ = process_group;
    let _ = force;
    let _ = killer.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_code_preserves_regular_process_codes() {
        assert_eq!(
            exit_code(&portable_pty::ExitStatus::with_exit_code(0)),
            Some(0)
        );
        assert_eq!(
            exit_code(&portable_pty::ExitStatus::with_exit_code(42)),
            Some(42)
        );
    }

    #[test]
    fn exit_code_matches_std_process_signal_semantics() {
        assert_eq!(
            exit_code(&portable_pty::ExitStatus::with_signal("SIGTERM")),
            None
        );
    }

    #[test]
    fn utf8_decoder_carries_split_multibyte_chars() {
        let mut decoder = Utf8ChunkDecoder::default();
        assert_eq!(decoder.push(&[0xe2]), None);
        assert_eq!(decoder.push(&[0x9c]), None);
        assert_eq!(decoder.push(&[0x93, b' ', b'o', b'k']), Some("✓ ok".into()));
    }
}
