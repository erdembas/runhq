//! Embedded terminal backed by a host PTY.
//!
//! Each service can have at most one active PTY session. The PTY is spawned
//! in the service's `cwd` with the user's default shell. Output is forwarded
//! to the frontend as Tauri events; input arrives via IPC commands.

use std::collections::HashMap;
use std::io::{Read, Write};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::AppHandle;
use tauri::Emitter;

use crate::AppState;

struct TermInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn Child + Send + 'static>,
}

pub struct TerminalManager {
    terms: Mutex<HashMap<String, TermInstance>>,
    app: AppHandle,
}

impl TerminalManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            terms: Mutex::new(HashMap::new()),
            app,
        }
    }

    pub fn create(&self, id: &str, cwd: &str, cols: u16, rows: u16) -> Result<()> {
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

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("failed to spawn shell")?;

        let reader = pair.master.try_clone_reader().context("clone reader")?;
        let writer = pair.master.take_writer().context("take writer")?;

        let term_id = id.to_string();
        let event_app = self.app.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let _ = event_app.emit(
                            "terminal://output",
                            TerminalOutput {
                                id: term_id.clone(),
                                data,
                            },
                        );
                    }
                }
            }
        });

        self.terms.lock().insert(
            id.to_string(),
            TermInstance {
                writer,
                master: pair.master,
                _child: child,
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

    pub fn destroy(&self, id: &str) -> Result<()> {
        if let Some(mut term) = self.terms.lock().remove(id) {
            let _ = term.writer.flush();
            let _ = term._child.kill();
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
struct TerminalOutput {
    id: String,
    data: Vec<u8>,
}

// ---- IPC commands --------------------------------------------------------

#[tauri::command]
pub fn terminal_create(
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .create(&id, &cwd, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.terminals.write(&id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .resize(&id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_destroy(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.terminals.destroy(&id).map_err(|e| e.to_string())
}
