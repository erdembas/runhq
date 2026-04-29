//! Embedded terminal backed by a host PTY.
//!
//! Each service can have at most one active PTY session. The PTY is spawned
//! in the service's `cwd` with the user's default shell. Output is forwarded
//! to the frontend through a typed Tauri [`Channel`] (one channel per
//! terminal id) — bypassing the global event bus, which avoids per-message
//! id-filter scans on the React side and keeps high-throughput streams
//! (e.g. `cargo build`, `vite dev`) cheap.
//!
//! ## Output pipeline
//!
//! ```text
//! PTY master fd ──read()──► reader thread ──mpsc──► flusher thread ──Channel──► xterm.js
//! ```
//!
//! Two threads, one channel. The reader does blocking byte reads off the
//! master fd and pushes raw chunks. The flusher coalesces those chunks in
//! 8 ms windows (or 32 KB caps) and ships a single base64-encoded payload
//! per flush. Coalescing is the difference between IPC pressure that
//! shrugs off `npm install` (~one event every few ms) and the previous
//! "one event per `read()`" model that buried the webview under
//! per-character JSON-array round-trips during progress bars.
//!
//! ## Lifecycle
//!
//! `create()` → spawn PTY shell → spawn reader/flusher → on Windows attach
//! a [`JobObject`] tree-kill guard. `destroy()` flushes the writer, kills
//! the child, and lets `TermInstance` drop drive the rest:
//!
//! 1. `master` drops → master fd closes → reader sees EOF → drops `chunk_tx`.
//! 2. flusher's `recv_timeout` returns `Disconnected` → drains residue → exits.
//! 3. `_job` drops (Windows) → kernel kills any descendants the shell forked.
//!
//! Threads exit naturally; we don't `join()` them on the destroy path
//! because the reader is parked in a blocking `read()` and joining there
//! is a deadlock waiting for the OS scheduler to give us EOF.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

use runhq_core::process_group::JobObject;

use crate::AppState;

/// Maximum window the flusher will hold a partial batch before shipping
/// it to the frontend. 8 ms is the sweet spot between two failure modes:
///
/// - **Too high** (≥ 16 ms): users perceive a lag between key release
///   and character echo for interactive REPLs (`python`, `psql`,
///   `node`). The PTY echoes immediately on the kernel side, but the
///   pixel doesn't move until our flusher ships.
/// - **Too low** (≤ 2 ms): defeats the whole point of batching — busy
///   compilers like `cargo` or `vite build` flood `read()` with hundreds
///   of small chunks per second and we're back to per-chunk IPC overhead.
///
/// 8 ms = ½ a 60 fps frame. The frame still has to render, so the user
/// can't actually see the difference; the IPC layer breathes; everyone
/// wins.
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);

/// Hard size cap that forces an immediate flush, even mid-window. Without
/// this, a single huge `read()` (e.g. a binary `cat` or a malicious
/// process spamming `printf`) could grow the accumulator unbounded
/// during the 8 ms window. 32 KB picks up roughly the upper bound of a
/// single PTY chunk on macOS/Linux while still being small enough that
/// the base64 encode + JSON serialize stays under 1 ms.
const FLUSH_THRESHOLD: usize = 32 * 1024;

/// Buffer the reader uses for each blocking `read()` call. Sized to
/// match a typical PTY chunk; smaller buffers cause more syscalls,
/// larger ones waste stack space without improving throughput because
/// the kernel rarely hands us more than ~8 KB at a time.
const READ_BUF: usize = 8 * 1024;

/// Payload pushed through the per-terminal [`Channel`].
///
/// The bytes are base64-encoded on the Rust side because Tauri's IPC
/// layer JSON-serializes typed channels: a `Vec<u8>` would expand to
/// `[12, 34, ...]` (3-4 chars per byte plus commas), while a base64
/// string costs ~1.33×. The frontend decodes via `atob` and writes
/// directly to xterm.js. We do NOT wrap in a struct with the terminal
/// id; the channel is already per-instance, so the id would be pure
/// IPC overhead.
#[derive(Clone, Serialize)]
pub struct TerminalOutput {
    /// Base64-encoded raw PTY bytes. May span multiple `read()` calls
    /// (the flusher coalesces) but never spans more than `FLUSH_INTERVAL`
    /// of wall-clock time.
    pub data: String,
}

struct TermInstance {
    /// Pipe writer feeding the PTY master. Held under the same lock as
    /// the rest of the manager so `terminal_write` can't race a
    /// concurrent `destroy`.
    writer: Box<dyn Write + Send>,
    /// PTY master handle. Kept alive for the lifetime of the run so
    /// `resize()` has somewhere to call `master.resize()`. Dropping it
    /// closes the master fd, which is what eventually frees the reader
    /// thread from its blocking `read()` after the child has exited.
    master: Box<dyn MasterPty + Send>,
    /// PTY shell child. Field order matters for `Drop`: this drops
    /// before `_job`, which is fine because we explicitly `kill()`
    /// before dropping the instance — see `TerminalManager::destroy`.
    _child: Box<dyn Child + Send + 'static>,
    /// Windows-only: Job Object that owns the shell + every descendant
    /// it spawns after assignment. On drop the kernel terminates the
    /// whole tree synchronously. Always-`Some` on a successful Windows
    /// spawn; `None` only if `OpenProcess`/assignment failed (logged
    /// at create time, run continues without containment). On non-
    /// Windows targets this is a zero-cost shim — see
    /// [`runhq_core::process_group`].
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

    /// Spin up a new PTY for `id`. If `id` already has a session, it's
    /// destroyed first — the React side recreates a terminal whenever
    /// its component remounts, so this idempotency keeps fast remount
    /// loops (HMR, theme switch causing parent rerender) from leaking
    /// shells.
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

        // Windows: attach the shell to a kill-on-close Job Object so
        // descendants the user spawns inside the terminal (`pnpm dev`,
        // long-running watchers) can't outlive the session. Best-effort:
        // attachment racing with an instant-exit child is logged but
        // does not fail the create — the user still gets a working
        // terminal, just without tree-kill semantics on close. On
        // non-Windows the shim is a no-op (Unix relies on the PTY
        // hangup to deliver SIGHUP through the foreground process
        // group).
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
                _child: child,
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

    /// Tear down the PTY for `id`. Idempotent: calling on a missing id
    /// is a no-op so React's StrictMode double-invoke pattern (which
    /// fires destroy twice on dev) doesn't surface as an error toast.
    pub fn destroy(&self, id: &str) -> Result<()> {
        if let Some(mut term) = self.terms.lock().remove(id) {
            // Best-effort flush of any user input still buffered in the
            // pipe writer — `write_all` returns once the OS pipe accepts
            // the bytes, but PTY masters frequently buffer until a flush
            // or read on the slave side. Skipping this leaves the last
            // typed character invisible if the user destroyed mid-keystroke.
            let _ = term.writer.flush();
            // Kill the shell explicitly. portable-pty's `Box<dyn Child>`
            // doesn't promise kill-on-drop on Windows (and even on Unix,
            // its drop only sends SIGHUP via PTY hangup, which some
            // shells trap). Once the child exits the slave side closes,
            // the master sees the hangup, the reader's `read()` returns
            // 0, and the flusher drains its residue and exits.
            let _ = term._child.kill();
            // Field-order drop continues here: master, child, _job. The
            // `_job` drop on Windows triggers KILL_ON_JOB_CLOSE for the
            // shell's whole descendant tree.
        }
        Ok(())
    }
}

// ---- Output pipeline -----------------------------------------------------

/// Glue the PTY master reader to the frontend channel through a
/// reader-thread → flusher-thread mpsc pair.
///
/// The split exists for one reason: blocking `read()` and timed
/// coalescing don't fit in the same thread cheaply. portable-pty's
/// reader is a `Box<dyn Read + Send>` with no `set_read_timeout` or
/// non-blocking mode exposed across all platforms (winpty in
/// particular doesn't honour the typical fd flags). So we accept the
/// cost of one extra thread per terminal in exchange for a clean
/// `recv_timeout`-driven flusher loop that's trivial to reason about.
fn spawn_output_pipeline(mut reader: Box<dyn Read + Send>, on_output: Channel<TerminalOutput>) {
    let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>();

    // Reader thread: blocking reads, no decoding, no encoding. Just
    // pump raw bytes into the channel. Exits on EOF or read error
    // (which is what we want — both mean "PTY is gone").
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if chunk_tx.send(buf[..n].to_vec()).is_err() {
                        // Flusher is gone — terminal was destroyed
                        // out from under us. Bail; nothing useful left
                        // to do with these bytes.
                        break;
                    }
                }
            }
        }
        // Dropping `chunk_tx` here makes the flusher's next
        // `recv_timeout` return `Disconnected` once it's drained
        // whatever's still in the queue, which is how we deliver "EOF
        // happened, ship the last batch and exit".
    });

    // Flusher thread: holds the per-terminal accumulator and the
    // Channel handle. Coalesces incoming chunks for FLUSH_INTERVAL or
    // FLUSH_THRESHOLD bytes (whichever comes first) and ships a single
    // base64-encoded payload per flush.
    std::thread::spawn(move || {
        // Pre-size to one full threshold so the typical flush doesn't
        // reallocate. 64 KB headroom for the rare case where a single
        // burst exceeds the threshold before we get a chance to flush.
        let mut acc: Vec<u8> = Vec::with_capacity(64 * 1024);
        loop {
            match chunk_rx.recv_timeout(FLUSH_INTERVAL) {
                Ok(chunk) => {
                    acc.extend_from_slice(&chunk);
                    // Drain anything else already queued without
                    // blocking — coalesces a burst of small reads into
                    // one IPC round-trip. Bound by FLUSH_THRESHOLD so
                    // pathological floods can't starve the flush.
                    while acc.len() < FLUSH_THRESHOLD {
                        match chunk_rx.try_recv() {
                            Ok(more) => acc.extend_from_slice(&more),
                            Err(_) => break,
                        }
                    }
                    if acc.len() >= FLUSH_THRESHOLD {
                        emit_batch(&on_output, &acc);
                        acc.clear();
                    }
                    // Otherwise wait for either the next chunk or the
                    // FLUSH_INTERVAL timeout to ship the residue.
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !acc.is_empty() {
                        emit_batch(&on_output, &acc);
                        acc.clear();
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    // Reader exited. Flush whatever's left and stop.
                    if !acc.is_empty() {
                        emit_batch(&on_output, &acc);
                    }
                    return;
                }
            }
        }
    });
}

fn emit_batch(channel: &Channel<TerminalOutput>, bytes: &[u8]) {
    // `Channel::send` returns Err only if the JS side has dropped its
    // receiver (component unmounted, window closed). Either way there's
    // nothing useful we can do here — silently drop.
    let _ = channel.send(TerminalOutput {
        data: BASE64.encode(bytes),
    });
}

// ---- Shell resolution ----------------------------------------------------

/// Resolve the user's preferred shell and the args required to launch it
/// as an interactive login session inside a PTY.
///
/// Order of preference per platform:
/// - **macOS**: `$SHELL` → `/bin/zsh`. Args via [`login_args_for`].
/// - **Linux**: `$SHELL` → `/bin/bash` → `/bin/sh`. Args via
///   [`login_args_for`].
/// - **Windows**: `$SHELL` (e.g. git-bash) → `pwsh.exe` →
///   `powershell.exe` → `%COMSPEC%` → `cmd.exe`. PowerShell variants
///   get `-NoLogo`; `cmd.exe` receives no extra args.
fn default_shell() -> (PathBuf, Vec<String>) {
    if let Some(custom) = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        let args = login_args_for(&custom);
        return (custom, args);
    }

    #[cfg(target_os = "macos")]
    {
        let zsh = PathBuf::from("/bin/zsh");
        let args = login_args_for(&zsh);
        (zsh, args)
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for candidate in ["/bin/bash", "/bin/sh"] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                let args = login_args_for(&path);
                return (path, args);
            }
        }
        let sh = PathBuf::from("/bin/sh");
        let args = login_args_for(&sh);
        (sh, args)
    }

    #[cfg(windows)]
    {
        if let Some(pwsh) = find_in_path("pwsh.exe") {
            return (pwsh, vec!["-NoLogo".to_string()]);
        }
        if let Some(ps) = find_in_path("powershell.exe") {
            return (ps, vec!["-NoLogo".to_string()]);
        }
        let comspec = std::env::var_os("COMSPEC")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("cmd.exe"));
        (comspec, Vec::new())
    }
}

/// Pick the right launch flags for a given shell binary path.
///
/// The historical bug we're fixing: passing only `-l` (login) to bash.
/// A login bash sources `.bash_profile` / `.profile` / `.bash_login`
/// but **not** `.bashrc` — and ~99% of users put their PATH, prompt,
/// and aliases in `.bashrc`. The result was a "naked" PTY where the
/// user's prompt theme, version-manager shims (nvm, fnm, asdf), and
/// command aliases all silently went missing.
///
/// Adding `-i` (interactive) on top makes bash also source `.bashrc`
/// and short-circuits the `[[ $- == *i* ]]` guards users wrap around
/// optional dotfile sections (Powerlevel10k, oh-my-bash autoload).
/// zsh and fish handle `-il` cleanly — zsh auto-detects TTY but `-i`
/// is harmless and mirrors what VS Code's integrated terminal sends;
/// fish requires explicit `-i` to enable interactive features in some
/// distros.
///
/// `sh` / `dash` / `ash` get `-l` only because their `-i` semantics
/// are inconsistent across implementations and they don't usually
/// benefit (no rc file by convention). PowerShell variants get
/// `-NoLogo`; `cmd.exe` gets nothing — its config model doesn't fit
/// the login/interactive split.
///
/// Falls through to the safe default `-i -l` for any unknown shell —
/// fish, nushell, elvish, etc. all accept these without complaint.
fn login_args_for(path: &Path) -> Vec<String> {
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match name.as_str() {
        // POSIX-strict shells: login only, no -i (semantics vary).
        "sh" | "dash" | "ash" => vec!["-l".to_string()],
        // Windows PowerShell editions — different convention entirely.
        "pwsh" | "powershell" => vec!["-NoLogo".to_string()],
        // cmd.exe doesn't understand login/interactive flags.
        "cmd" => Vec::new(),
        // bash, zsh, fish, nushell, elvish, xonsh, etc. — interactive +
        // login. `-i -l` over `-il` for clarity in `ps` listings; both
        // are equivalent to the shell.
        _ => vec!["-i".to_string(), "-l".to_string()],
    }
}

#[cfg(windows)]
fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ---- IPC commands --------------------------------------------------------

#[tauri::command]
pub fn terminal_create(
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalOutput>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .create(&id, &cwd, cols, rows, on_output)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .terminals
        .write(&id, &data)
        .map_err(|e| format!("{e:#}"))
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
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn terminal_destroy(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.terminals.destroy(&id).map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_args_known_shells() {
        // Use bare file names instead of full paths so the test is
        // path-separator-independent — Unix `Path` doesn't recognise
        // `\\` as a separator, so a Windows-style absolute path like
        // `C:\\Windows\\System32\\cmd.exe` parses as a single
        // file_stem on Linux/macOS and breaks the dispatch we're
        // trying to assert. The matching logic itself only cares
        // about `file_stem`, so bare names exercise the full code
        // path.
        assert_eq!(
            login_args_for(Path::new("/bin/bash")),
            vec!["-i".to_string(), "-l".to_string()]
        );
        assert_eq!(
            login_args_for(Path::new("/usr/local/bin/zsh")),
            vec!["-i".to_string(), "-l".to_string()]
        );
        assert_eq!(
            login_args_for(Path::new("/usr/local/bin/fish")),
            vec!["-i".to_string(), "-l".to_string()]
        );
        assert_eq!(login_args_for(Path::new("/bin/sh")), vec!["-l".to_string()]);
        assert_eq!(
            login_args_for(Path::new("/bin/dash")),
            vec!["-l".to_string()]
        );
        assert_eq!(login_args_for(Path::new("cmd.exe")), Vec::<String>::new());
        assert_eq!(
            login_args_for(Path::new("pwsh.exe")),
            vec!["-NoLogo".to_string()]
        );
        assert_eq!(
            login_args_for(Path::new("powershell.exe")),
            vec!["-NoLogo".to_string()]
        );
    }

    #[test]
    fn login_args_unknown_shell_defaults_to_interactive_login() {
        // Future-proofing: if a user has nushell / xonsh / elvish set as
        // $SHELL, we still hand them an interactive-login session
        // rather than silently degrading to plain login.
        assert_eq!(
            login_args_for(Path::new("/usr/local/bin/nu")),
            vec!["-i".to_string(), "-l".to_string()]
        );
    }
}
