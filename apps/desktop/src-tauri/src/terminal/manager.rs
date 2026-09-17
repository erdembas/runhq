use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use runhq_core::process_group::JobObject;

use super::pipeline::{spawn_output_pipeline, OutputFlow};
use super::shell::default_shell;
use super::TerminalOutput;

struct TermInstance {
    /// Pipe writer feeding the PTY master.
    writer: Mutex<Box<dyn Write + Send>>,
    /// PTY master handle. Kept alive so `resize()` has somewhere to call.
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// PTY shell child. Killed explicitly in `TerminalManager::destroy`.
    child: Mutex<Box<dyn Child + Send + 'static>>,
    flow: Arc<OutputFlow>,
    /// Windows-only tree-kill guard. No-op shim on non-Windows targets.
    job: Mutex<Option<JobObject>>,
}

#[derive(Clone)]
pub struct TerminalManager {
    terms: Arc<Mutex<HashMap<String, Arc<TermInstance>>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            terms: Arc::new(Mutex::new(HashMap::new())),
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
        stream_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalOutput>,
    ) -> Result<()> {
        self.create_command(id, stream_id, cwd, cols, rows, on_output, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_command(
        &self,
        id: &str,
        stream_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalOutput>,
        command: Option<(String, Vec<String>)>,
    ) -> Result<()> {
        self.destroy(id)?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open PTY")?;

        let agent_command = command.is_some();
        let (shell, args) = command
            .map(|(path, args)| (std::path::PathBuf::from(path), args))
            .unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if agent_command {
            if let Some(path) = runhq_core::agents::agent_command_path(&shell) {
                cmd.env("PATH", path);
            }
        }

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

        let flow = Arc::new(OutputFlow::new(stream_id.to_owned()));

        self.terms.lock().insert(
            id.to_string(),
            Arc::new(TermInstance {
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child: Mutex::new(child),
                flow: flow.clone(),
                job: Mutex::new(job),
            }),
        );

        spawn_output_pipeline(reader, on_output, flow);
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Arc<TermInstance>> {
        self.terms
            .lock()
            .get(id)
            .cloned()
            .context("terminal not found")
    }

    pub fn acknowledge(&self, id: &str, stream_id: &str, bytes: usize) -> Result<()> {
        let term = self.get(id)?;
        if term.flow.id == stream_id {
            term.flow.acknowledge(bytes);
        }
        Ok(())
    }

    pub fn write(&self, id: &str, stream_id: &str, data: &[u8]) -> Result<()> {
        let term = self.get(id)?;
        anyhow::ensure!(term.flow.id == stream_id, "terminal session has changed");
        let mut writer = term.writer.lock();
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, stream_id: &str, cols: u16, rows: u16) -> Result<()> {
        let term = self.get(id)?;
        anyhow::ensure!(term.flow.id == stream_id, "terminal session has changed");
        term.master
            .lock()
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("resize failed")?;
        Ok(())
    }

    /// Tear down the PTY for `id`. Idempotent for React StrictMode dev paths.
    pub fn destroy(&self, id: &str) -> Result<()> {
        // Drop the registry lock before touching OS handles. In particular,
        // never wait for a blocked writer to flush before killing its shell.
        let removed = self.terms.lock().remove(id);
        if let Some(term) = removed {
            term.flow.close();
            // A foreground TUI may keep the slave open and leave writes blocked
            // even after its parent shell exits. Terminate its PTY process group.
            #[cfg(unix)]
            if let Some(group) = term.master.lock().process_group_leader() {
                if group > 0 {
                    // SAFETY: the positive group id came from this PTY; a
                    // negative pid targets only that managed process group.
                    unsafe {
                        libc::kill(-group, libc::SIGKILL);
                    }
                }
            }
            // Close the Windows tree-kill guard even if a writer still holds
            // an Arc to this instance.
            *term.job.lock() = None;
            let mut child = term.child.lock();
            let _ = child.kill();
            // Reap asynchronously: shutdown must not wait for child exit.
            drop(child);
            std::thread::spawn(move || {
                let _ = term.child.lock().wait();
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{ChildKiller, ExitStatus};
    use std::io;
    use std::sync::mpsc;
    use std::time::Duration;

    #[derive(Debug, Clone)]
    struct TestChild;

    impl ChildKiller for TestChild {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    impl Child for TestChild {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            Ok(Some(ExitStatus::with_exit_code(0)))
        }
        fn wait(&mut self) -> io::Result<ExitStatus> {
            Ok(ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    struct TestMaster;

    impl MasterPty for TestMaster {
        fn resize(&self, _: PtySize) -> Result<()> {
            Ok(())
        }
        fn get_size(&self) -> Result<PtySize> {
            Ok(PtySize::default())
        }
        fn try_clone_reader(&self) -> Result<Box<dyn io::Read + Send>> {
            Ok(Box::new(io::empty()))
        }
        fn take_writer(&self) -> Result<Box<dyn Write + Send>> {
            Ok(Box::new(io::sink()))
        }
        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<i32> {
            None
        }
        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<std::os::fd::RawFd> {
            None
        }
    }

    fn instance() -> Arc<TermInstance> {
        Arc::new(TermInstance {
            writer: Mutex::new(Box::new(io::sink())),
            master: Mutex::new(Box::new(TestMaster)),
            child: Mutex::new(Box::new(TestChild)),
            flow: Arc::new(OutputFlow::default()),
            job: Mutex::new(None),
        })
    }

    #[cfg(unix)]
    #[test]
    fn custom_tool_arguments_are_passed_literally_to_the_pty() {
        use base64::Engine;
        let manager = TerminalManager::new();
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(data) = body {
                let _ = tx.send(data);
            }
            Ok(())
        });
        manager
            .create_command(
                "tool-test",
                "generation",
                "/tmp",
                120,
                24,
                channel,
                Some((
                    "/bin/echo".into(),
                    vec!["$(literal)".into(), "a value with spaces".into()],
                )),
            )
            .unwrap();
        let data = rx
            .recv_timeout(Duration::from_secs(3))
            .expect("tool output");
        let payload: serde_json::Value = serde_json::from_str(&data).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload["data"].as_str().unwrap())
            .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("$(literal) a value with spaces"));
        manager.destroy("tool-test").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn destroying_a_real_pty_releases_blocked_input() {
        let manager = TerminalManager::new();
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "stty raw -echo; printf ready; exec sleep 30"]);
        let child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut ready = [0; 5];
        reader.read_exact(&mut ready).unwrap();
        assert_eq!(&ready, b"ready");
        let writer = pair.master.take_writer().unwrap();
        let flow = Arc::new(OutputFlow::default());
        let stream_id = flow.id.clone();
        manager.terms.lock().insert(
            "blocked".into(),
            Arc::new(TermInstance {
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child: Mutex::new(child),
                flow,
                job: Mutex::new(None),
            }),
        );
        let worker_manager = manager.clone();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = worker_manager.write("blocked", &stream_id, &vec![b'x'; 1024 * 1024]);
            tx.send(result).unwrap();
        });
        // A non-reading slave in raw mode must eventually fill the PTY.
        let was_blocked = rx.recv_timeout(Duration::from_millis(50)).is_err();
        manager.destroy("blocked").unwrap();
        assert!(was_blocked, "the test must exercise a blocked write");
        rx.recv_timeout(Duration::from_secs(2))
            .expect("closing the PTY must release its writer")
            .ok();
        worker.join().unwrap();
    }

    #[test]
    fn stale_input_and_resize_cannot_target_a_replacement_session() {
        let manager = TerminalManager::new();
        manager.terms.lock().insert("a".into(), instance());
        assert!(manager.write("a", "old-session", b"stale input").is_err());
        assert!(manager.resize("a", "old-session", 80, 24).is_err());
    }

    #[test]
    fn blocked_input_does_not_block_resize_other_terminals_or_destroy() {
        let manager = TerminalManager::new();
        let a = instance();
        manager.terms.lock().insert("a".into(), a.clone());
        manager.terms.lock().insert("b".into(), instance());
        let blocked_writer = a.writer.lock();
        let worker_manager = manager.clone();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            worker_manager
                .resize("a", &worker_manager.get("a").unwrap().flow.id, 120, 40)
                .unwrap();
            worker_manager
                .write("b", &worker_manager.get("b").unwrap().flow.id, b"hello")
                .unwrap();
            worker_manager.destroy("a").unwrap();
            tx.send(()).unwrap();
        });
        let result = rx.recv_timeout(Duration::from_secs(1));
        drop(blocked_writer);
        worker.join().unwrap();
        result.expect("unrelated work must finish while the first writer is locked");
        assert!(manager.get("a").is_err());
        assert!(manager.get("b").is_ok());
    }
}
