/// Wrap a user command in the appropriate shell so familiar syntax works.
pub(super) fn shell_command(cmd: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), cmd.to_string()])
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        (shell, vec!["-lc".into(), cmd.to_string()])
    }
}

/// Prefix a user command with `export PATH='<override>':"$PATH"` so the
/// override wins against version managers (nvm, fnm, asdf…) that prepend
/// their own toolchain to `$PATH` from `.zshrc` / `.bashrc` during the
/// login-shell init that runs before the user's command.
///
/// We deliberately do NOT use `exec` to chain into the user's command:
/// `entry.cmd` is a free-form shell string and frequently contains `&&`,
/// `||`, `;`, pipes, or backgrounded jobs (`pnpm dev && tail -f log` is the
/// example called out in `process.rs` design docs). `exec` only accepts a
/// single program followed by args, so wrapping it that way would silently
/// break those forms. Plain `;` separation keeps the existing subshell
/// model intact.
///
/// Single-quoting the override path makes spaces, `$`, `"`, and other
/// metacharacters inert. Embedded single quotes are escaped via the
/// classic `'\''` close-escape-open pattern so a path like
/// `/Users/me/'weird'/bin` still produces a syntactically valid script.
///
/// On Windows we leave the command untouched: `cmd.exe` doesn't read
/// dotfiles in the same way, the env-level `cmd.env("PATH", …)` we already
/// set is sufficient, and `cmd /C` doesn't have a clean equivalent of
/// POSIX `export … ;` semantics worth bending the abstraction for.
/// Compose the user's pre-command lines and main command into a single
/// shell script that runs in ONE subshell. Lines from `pre_command`
/// run first, then the main command, all sharing the same env — so
/// `nvm use 14`, `unset NODE_OPTIONS`, `source .env`, `export FOO=bar`
/// in pre-command actually reach the main command.
///
/// `set -e` is the safety net: any non-zero exit from a pre-command
/// line aborts the script before main runs. This matches the user's
/// mental model — if `nvm use 14` failed, you don't want `npm start`
/// to silently run on the wrong toolchain. Without `set -e`, pre-
/// command failures would fall through and surface as confusing,
/// far-from-cause errors in main's output.
///
/// We deliberately do NOT use `exec` to launch the main command at the
/// end of the script. `exec` only accepts a single program + args and
/// would silently break compound forms like `pnpm dev && tail -f log`,
/// `cmd1 || cmd2`, pipes, or backgrounded jobs — all of which RunHQ
/// design docs explicitly support. Plain trailing-line execution keeps
/// the existing free-form shell semantics intact.
///
/// When the user has no pre-command (or it's all whitespace) we return
/// the main command verbatim — no `set -e` prelude — so the empty case
/// stays bit-identical to the pre-feature behaviour and we don't
/// mysteriously start aborting on errors users were used to ignoring.
pub(super) fn compose_launch_script(pre_command: Option<&str>, main_cmd: &str) -> String {
    let pre = pre_command.map(str::trim).filter(|s| !s.is_empty());
    match pre {
        Some(pre) => format!("set -e\n{pre}\nset +e\n{main_cmd}"),
        None => main_cmd.to_string(),
    }
}

pub(super) fn wrap_with_path_override(cmd: &str, path_override: Option<&str>) -> String {
    if cfg!(windows) {
        return cmd.to_string();
    }
    match path_override {
        Some(extra) => {
            let trimmed = extra.trim();
            if trimmed.is_empty() {
                cmd.to_string()
            } else {
                let escaped = trimmed.replace('\'', "'\\''");
                format!("export PATH='{escaped}':\"$PATH\"; {cmd}")
            }
        }
        None => cmd.to_string(),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn wrap_no_override_passes_command_through() {
        assert_eq!(wrap_with_path_override("npm start", None), "npm start");
    }

    #[test]
    fn wrap_empty_override_passes_command_through() {
        assert_eq!(wrap_with_path_override("npm start", Some("")), "npm start");
        assert_eq!(
            wrap_with_path_override("npm start", Some("   ")),
            "npm start"
        );
    }

    #[test]
    fn wrap_simple_override_prepends_export() {
        let out = wrap_with_path_override(
            "react-app-rewired start",
            Some("/Users/me/node-v14.21.3/bin"),
        );
        assert_eq!(
            out,
            "export PATH='/Users/me/node-v14.21.3/bin':\"$PATH\"; react-app-rewired start"
        );
    }

    #[test]
    fn wrap_preserves_shell_compound_operators() {
        // Free-form user commands routinely chain with `&&`, `||`, `;`,
        // pipes, and backgrounded jobs. Wrapping must keep them intact.
        let out = wrap_with_path_override("pnpm dev && tail -f foo.log", Some("/opt/node/bin"));
        assert!(out.ends_with("pnpm dev && tail -f foo.log"));
        assert!(out.starts_with("export PATH='/opt/node/bin':\"$PATH\";"));
    }

    #[test]
    fn wrap_escapes_embedded_single_quotes_in_path() {
        // Pathological but legal: a directory name with a literal `'`.
        // Must produce a script that any POSIX shell parses cleanly.
        let out = wrap_with_path_override("node -v", Some("/Users/me/'weird'/bin"));
        // Classic close-escape-open trick: `'…'\''…'`.
        assert_eq!(
            out,
            "export PATH='/Users/me/'\\''weird'\\''/bin':\"$PATH\"; node -v"
        );
    }

    #[test]
    fn wrap_trims_surrounding_whitespace_in_override() {
        let out = wrap_with_path_override("ls", Some("  /opt/bin  "));
        assert_eq!(out, "export PATH='/opt/bin':\"$PATH\"; ls");
    }

    // -------- compose_launch_script --------

    #[test]
    fn compose_no_pre_returns_main_unchanged() {
        // Empty/whitespace/None pre-commands all leave the main command
        // bit-identical to the legacy behaviour. This is load-bearing —
        // existing services without a pre-command must not start
        // hitting `set -e` semantics they didn't ask for.
        assert_eq!(compose_launch_script(None, "npm start"), "npm start");
        assert_eq!(compose_launch_script(Some(""), "npm start"), "npm start");
        assert_eq!(
            compose_launch_script(Some("   \n  "), "npm start"),
            "npm start"
        );
    }

    #[test]
    fn compose_pre_runs_in_same_session_with_errexit_around_setup() {
        // The whole point of this fix: the user's pre-command lines and
        // their main command live in ONE shell script. `set -e` brackets
        // only the pre-command region — main runs with errexit OFF so
        // its own internal compound shell semantics (&&, ||, pipes,
        // background jobs) keep working unchanged.
        let out = compose_launch_script(Some("nvm use 14\nunset NODE_OPTIONS"), "npm start");
        assert_eq!(
            out,
            "set -e\nnvm use 14\nunset NODE_OPTIONS\nset +e\nnpm start"
        );
    }

    #[test]
    fn compose_preserves_main_command_compound_operators() {
        // The composed script must not break `&&`/`||`/`;`/pipes in
        // either the pre-command or main. They flow through verbatim.
        let out = compose_launch_script(
            Some("export FOO=bar\nsource .env"),
            "pnpm dev && tail -f foo.log",
        );
        assert!(out.starts_with("set -e\nexport FOO=bar\nsource .env\nset +e\n"));
        assert!(out.ends_with("pnpm dev && tail -f foo.log"));
    }

    #[test]
    fn compose_trims_pre_block_but_keeps_internal_blank_lines() {
        // Leading/trailing whitespace in the pre-command field is just
        // textarea slop — strip it. But don't touch internal blank
        // lines (a user might use them for visual grouping in long
        // setup scripts; shell ignores blank lines anyway).
        let out = compose_launch_script(Some("\n\nexport A=1\n\nexport B=2\n\n"), "main");
        assert_eq!(out, "set -e\nexport A=1\n\nexport B=2\nset +e\nmain");
    }
}
