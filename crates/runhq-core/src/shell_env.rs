//! GUI-launched-process `$PATH` recovery.
//!
//! ## The problem
//!
//! When a macOS `.app` bundle is double-clicked from Finder/Dock, it inherits
//! `launchd`'s minimal `$PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`). The user's
//! shell rc (`.zshrc`, `.bash_profile`, etc.) is never sourced, so dev tools
//! installed via `brew`, `nvm`, `fnm`, `volta`, `asdf`, `rustup`, `pyenv`,
//! `pipx`, etc. are **invisible** to any subprocess RunHQ spawns.
//!
//! In dev (`cargo run` from a terminal) this never bites — the parent shell
//! already exports a fat `$PATH`, which is inherited verbatim. So bugs of the
//! form "feature works in dev, silently no-ops in production" are almost
//! always a missing binary on `$PATH`.
//!
//! Concrete failure mode that motivated this module: `overview::run_timed`
//! shells out to `npm outdated` / `cargo audit` / `pip-audit`. In a
//! GUI-launched build every spawn returns `Err(NotFound)`, which is mapped
//! to `None` for UI-friendly degradation. The dashboard then reports
//! "0 outdated, 0 vulnerabilities" instantly and the user sees a no-op
//! Rescan button.
//!
//! ## The fix — two layers
//!
//! 1. **Probe the user's login shell** for its `$PATH`. Captures whatever
//!    `.zprofile` / `.bash_profile` / `.profile` exports (Homebrew shellenv,
//!    `cargo env`, etc.).
//! 2. **Always merge in canonical dev-tool directories** as a fallback —
//!    even when the login probe succeeds. Many users put `nvm`/`fnm`
//!    initialisation in `.zshrc` (interactive only), which `-l` does NOT
//!    source on macOS. Without this fallback, `npm` would still be invisible
//!    despite a successful probe. Also covers `~/.cargo/bin`, `~/.local/bin`,
//!    `~/.volta/bin`, `~/.asdf/shims`, `pyenv` shims, etc.
//!
//! Both layers run unconditionally on every startup. Cost is sub-100ms
//! and gives us belt-and-suspenders coverage; if the user installs a new
//! tool runner mid-session they just relaunch.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// Synchronously refresh the process `$PATH`.
///
/// 1. Run a login-shell probe (`zsh -lc 'printf %s "$PATH"'` or equivalent).
/// 2. Always layer canonical dev-tool dirs (Homebrew, Cargo, nvm/fnm/volta,
///    asdf, pyenv, system bins) on top.
/// 3. Merge with the inherited PATH (deduped, primary order preserved).
/// 4. `set_var` the result so every subprocess we spawn from now on inherits
///    the fat PATH.
///
/// Errors are logged via `tracing::warn!` and otherwise swallowed. Failing to
/// expand `$PATH` should degrade gracefully rather than abort startup.
pub fn import_login_shell_path() {
    if cfg!(windows) {
        return;
    }

    let inherited = std::env::var("PATH").unwrap_or_default();
    let probed = probe_login_shell_path();
    let canonical = canonical_dev_tool_dirs();

    // Merge order matters:
    // 1. probed (most authoritative — reflects user's own setup)
    // 2. canonical (catches nvm/fnm/asdf shims that `.zprofile` often misses)
    // 3. inherited launchd PATH (system bins as a last resort)
    //
    // Dedup preserves first-seen order so the probed PATH wins on ties.
    let mut merged_parts: Vec<String> = Vec::new();
    if let Some(p) = probed.as_deref() {
        merged_parts.push(p.to_string());
    }
    merged_parts.push(canonical);
    if !inherited.is_empty() {
        merged_parts.push(inherited);
    }
    let merged = merge_paths(&merged_parts);

    if merged.is_empty() {
        tracing::warn!("no PATH segments collected; leaving env untouched");
        return;
    }

    // SAFETY: `set_var` is `unsafe` on Rust 2024+. We're called once on the
    // main thread during Tauri `setup()` before any worker thread spawns,
    // so there are no concurrent readers.
    #[allow(unused_unsafe)]
    unsafe {
        std::env::set_var("PATH", &merged);
    }

    tracing::info!(
        len = merged.len(),
        entries = merged.split(':').count(),
        probe_succeeded = probed.is_some(),
        "PATH refreshed for GUI-launched process"
    );
    tracing::debug!(path = %merged, "merged PATH");
}

fn probe_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());

    // `-l` sources `.zprofile` / `.bash_profile` / `.profile`. We
    // deliberately skip `-i` (interactive) — that can print prompts/banners
    // on stderr, hang on remote `command-not-found` lookups, and run plug-in
    // chains we don't need just to read PATH.
    //
    // `printf %s` (rather than `echo -n`) keeps output boring across shells:
    // `echo -n` prints `-n` literally on some `/bin/sh` implementations.
    let output = run_with_timeout(
        &shell,
        &["-lc", "printf %s \"$PATH\""],
        Duration::from_secs(3),
    );

    let Some(out) = output else {
        tracing::warn!(
            shell = %shell,
            "shell PATH probe failed or timed out; falling back to canonical dirs"
        );
        return None;
    };

    if !out.status.success() {
        tracing::warn!(
            shell = %shell,
            code = ?out.status.code(),
            "shell PATH probe exited non-zero; falling back to canonical dirs"
        );
        return None;
    }

    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(path)
}

/// Hand-curated list of directories where dev binaries live on macOS/Linux.
///
/// Rationale for inclusion:
///
/// - **Homebrew** (`/opt/homebrew/bin` Apple Silicon, `/usr/local/bin` Intel)
///   — `brew install node` lands here, plus `brew install` of `pip-audit`,
///   `cargo-audit`, etc.
/// - **Cargo** (`~/.cargo/bin`) — `rustup` installs every Rust binary here,
///   including `cargo`, `rustc`, `cargo-audit`, `cargo-deny`.
/// - **`~/.local/bin`** — pip's user installs (`pipx`, `pip-audit`) and
///   most Python tooling.
/// - **nvm globs** (`~/.nvm/versions/node/*/bin`) — every Node version
///   installed via nvm. Globbed because users commonly switch versions per
///   project. We resolve all of them; the latest-installed wins on ties.
/// - **fnm** (`~/.fnm/aliases/default/bin`, `~/Library/Application
///   Support/fnm/aliases/default/bin`) — fnm's "default" alias.
/// - **Volta** (`~/.volta/bin`) — Volta's shim directory; one binary
///   resolves any Node/npm/yarn version automatically.
/// - **asdf** (`~/.asdf/shims`) — asdf's universal shim for every plugin.
/// - **pyenv** (`~/.pyenv/shims`) — pyenv's per-version Python shim.
/// - **System bins** (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`) — failsafe.
///
/// Order matters: more user-specific paths come first so `~/.cargo/bin`
/// overrides any legacy system Rust install.
fn canonical_dev_tool_dirs() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home = dirs::home_dir();

    // User-installed package managers and language toolchains.
    if let Some(h) = home.as_ref() {
        dirs.push(h.join(".cargo/bin"));
        dirs.push(h.join(".local/bin"));
        dirs.push(h.join(".volta/bin"));
        dirs.push(h.join(".asdf/shims"));
        dirs.push(h.join(".pyenv/shims"));
        dirs.push(h.join(".rbenv/shims"));
        dirs.push(h.join(".fnm/aliases/default/bin"));
        dirs.push(h.join("Library/Application Support/fnm/aliases/default/bin"));
        dirs.push(h.join(".bun/bin"));
        dirs.push(h.join(".deno/bin"));

        // nvm: every installed Node version exposes its bin under
        // `~/.nvm/versions/node/<version>/bin`. We can't predict which
        // version the user has active, so we expose them all and let
        // `Command::spawn`'s PATH search find the first matching binary.
        if let Ok(entries) = std::fs::read_dir(h.join(".nvm/versions/node")) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    dirs.push(entry.path().join("bin"));
                }
            }
        }
    }

    // Homebrew + system. Apple Silicon's `/opt/homebrew/bin` doesn't exist
    // on Intel macs and vice versa — pushing both is harmless because
    // missing dirs are silently skipped during PATH lookup.
    #[cfg(target_os = "macos")]
    {
        for p in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            dirs.push(PathBuf::from(p));
        }
    }

    #[cfg(target_os = "linux")]
    {
        for p in [
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/snap/bin",
            "/var/lib/flatpak/exports/bin",
        ] {
            dirs.push(PathBuf::from(p));
        }
    }

    dirs.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(":")
}

fn run_with_timeout(
    program: &str,
    args: &[&str],
    deadline: Duration,
) -> Option<std::process::Output> {
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();
    let program = program.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    thread::spawn(move || {
        let result = Command::new(&program)
            .args(args.iter().map(String::as_str))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(deadline) {
        Ok(Ok(output)) => Some(output),
        Ok(Err(_)) | Err(_) => None,
    }
}

/// De-duplicate path entries while preserving first-seen order across all
/// inputs. Empty segments are dropped so a stray `:` in any input doesn't
/// turn into a "current directory" PATH entry (a security footgun).
fn merge_paths(parts: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for chunk in parts {
        for entry in chunk.split(':') {
            if entry.is_empty() {
                continue;
            }
            if seen.insert(entry.to_string()) {
                out.push(entry);
            }
        }
    }
    out.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_paths_preserves_primary_order() {
        let merged = merge_paths(&["/a:/b:/c".into(), "/x:/b:/y".into()]);
        assert_eq!(merged, "/a:/b:/c:/x:/y");
    }

    #[test]
    fn merge_paths_skips_empty_segments() {
        let merged = merge_paths(&["/a::/b".into(), "::/c:".into()]);
        assert_eq!(merged, "/a:/b:/c");
    }

    #[test]
    fn merge_paths_dedupes_across_inputs() {
        let merged = merge_paths(&[
            "/usr/local/bin:/opt/homebrew/bin".into(),
            "/opt/homebrew/bin:/bin".into(),
        ]);
        assert_eq!(merged, "/usr/local/bin:/opt/homebrew/bin:/bin");
    }

    #[test]
    fn merge_paths_handles_three_inputs() {
        let merged = merge_paths(&["/a:/b".into(), "/b:/c".into(), "/c:/d".into()]);
        assert_eq!(merged, "/a:/b:/c:/d");
    }

    // Gated to Unix-likes because `canonical_dev_tool_dirs` only emits
    // OS-specific system-bin entries under `cfg(target_os = "macos")` /
    // `cfg(target_os = "linux")`. On Windows the binding would be unused
    // (clippy `-D warnings` rejects this in CI) and the function isn't
    // even called in production — `import_login_shell_path` early-returns
    // for `cfg!(windows)`.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn canonical_includes_homebrew_on_macos() {
        let canonical = canonical_dev_tool_dirs();
        #[cfg(target_os = "macos")]
        {
            assert!(canonical.contains("/opt/homebrew/bin"));
            assert!(canonical.contains("/usr/local/bin"));
        }
        #[cfg(target_os = "linux")]
        {
            assert!(canonical.contains("/usr/local/bin"));
        }
    }
}
