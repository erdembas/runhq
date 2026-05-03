use std::collections::HashMap;
use std::io::Write;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use runhq_core::process_group::JobObject;

use super::pipeline::spawn_output_pipeline;
use super::shell::default_shell;
use super::TerminalOutput;

struct TermInstance {
    /// Pipe writer feeding the PTY master.
    writer: Box<dyn Write + Send>,
    /// PTY master handle. Kept alive so `resize()` has somewhere to call.
    master: Box<dyn MasterPty + Send>,
    /// PTY shell child. Killed explicitly in `TerminalManager::destroy`.
    child: Box<dyn Child + Send + 'static>,
    /// Windows-only tree-kill guard. No-op shim on non-Windows targets.
    _job: Option<JobObject>,
}

pub struct TerminalManager {
    terms: Mutex<HashMap<String, TermInstance>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            terms: Mutex::new(HashMap::new()),
        }
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalOutput>,
    ) -> Result<()> {
        if self.terms.lock().contains_key(id) {
            self.destroy(id)?;
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open PTY")?;

        let (shell, args) = default_shell();
        let mut cmd = CommandBuilder::new(&shell);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("failed to spawn shell")?;

        let job = match child.process_id() {
            Some(pid) => {
                #[cfg(windows)]
                {
                    match JobObject::attach_kill_on_close(pid) {
                        Ok(j) => Some(j),
                        Err(e) => {
                            tracing::warn!(
                                "terminal {id}: failed to attach Job Object (pid {pid}): {e} \
                                 — descendants spawned in this terminal may outlive it"
                            );
                            None
                        }
                    }
                }
                #[cfg(not(windows))]
                {
                    JobObject::attach_kill_on_close(pid).ok()
                }
            }
            None => None,
        };

        let reader = pair.master.try_clone_reader().context("clone reader")?;
        let writer = pair.master.take_writer().context("take writer")?;

        spawn_output_pipeline(reader, on_output);

        self.terms.lock().insert(
            id.to_string(),
            TermInstance {
                writer,
                master: pair.master,
                child,
                _job: job,
            },
        );

        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let mut terms = self.terms.lock();
        let term = terms.get_mut(id).context("terminal not found")?;
        term.writer.write_all(data)?;
        term.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let terms = self.terms.lock();
        let term = terms.get(id).context("terminal not found")?;
        term.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("resize failed")?;
        Ok(())
    }

    /// Tear down the PTY for `id`. Idempotent for React StrictMode dev paths.
    pub fn destroy(&self, id: &str) -> Result<()> {
        if let Some(mut term) = self.terms.lock().remove(id) {
            let _ = term.writer.flush();
            let _ = term.child.kill();
        }
        Ok(())
    }
}
