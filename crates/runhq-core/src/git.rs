//! Lightweight git integration built on top of the `git` CLI.
//!
//! We shell out rather than linking libgit2 to keep the core crate's build
//! surface small and portable — RunHQ targets local developer machines where
//! `git` is already installed, so the tradeoff is an easy win. All functions
//! are no-ops (returning `None` / empty data) when the path is not inside a
//! working tree, so callers can treat "not a git repo" as the normal case.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum FileDiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    pub status: FileDiffStatus,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiffSummary {
    pub files: Vec<FileDiff>,
    pub total_additions: usize,
    pub total_deletions: usize,
}

/// Snapshot of the working tree and upstream relation at a single instant.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitStatus {
    /// Current branch, or `None` when HEAD is detached.
    pub branch: Option<String>,
    /// Short (7-char) hash of HEAD, or `None` if the repo is unborn.
    pub head_short: Option<String>,
    /// Full 40-char hash of HEAD.
    pub head_full: Option<String>,
    /// True if `git status --porcelain` has any entries (staged, unstaged, or untracked).
    pub is_dirty: bool,
    /// Number of changed files surfaced by `git status --porcelain`
    /// (includes staged, unstaged, and untracked).
    pub dirty_count: usize,
    /// Commits the local branch is ahead of its upstream. 0 when no upstream.
    pub ahead: usize,
    /// Commits the local branch is behind its upstream. 0 when no upstream.
    pub behind: usize,
    /// Upstream ref (e.g. `origin/main`) or `None` when untracked.
    pub upstream: Option<String>,
    /// Metadata of the commit at HEAD.
    pub last_commit: Option<CommitInfo>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash_short: String,
    pub hash_full: String,
    pub author: String,
    pub email: String,
    pub subject: String,
    /// Author time, seconds since Unix epoch.
    pub timestamp: i64,
}

/// True if `cwd` lives inside a git working tree.
pub fn is_repo(cwd: &Path) -> bool {
    run_git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|(ok, stdout, _)| ok && stdout.trim() == "true")
        .unwrap_or(false)
}

/// Read a full status snapshot. Returns `None` when `cwd` is not a repo so
/// callers can shortcut without treating it as an error.
pub fn status(cwd: &Path) -> Option<GitStatus> {
    if !is_repo(cwd) {
        return None;
    }

    let branch = run_git(cwd, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .and_then(|(ok, out, _)| {
            if ok {
                Some(out.trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty());

    let head_full = run_git(cwd, &["rev-parse", "HEAD"])
        .ok()
        .and_then(|(ok, out, _)| {
            if ok {
                Some(out.trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty());

    let head_short = head_full.as_ref().map(|h| h.chars().take(7).collect());

    let (is_dirty, dirty_count) = match run_git(cwd, &["status", "--porcelain"]) {
        Ok((true, out, _)) => {
            let count = out.lines().filter(|l| !l.is_empty()).count();
            (count > 0, count)
        }
        _ => (false, 0),
    };

    let upstream = run_git(
        cwd,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .and_then(|(ok, out, _)| {
        if ok {
            Some(out.trim().to_string())
        } else {
            None
        }
    })
    .filter(|s| !s.is_empty());

    let (ahead, behind) = upstream
        .as_ref()
        .and_then(|_| {
            run_git(
                cwd,
                &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
            )
            .ok()
        })
        .and_then(|(ok, out, _)| {
            if !ok {
                return None;
            }
            let mut parts = out.split_whitespace();
            let behind: usize = parts.next()?.parse().ok()?;
            let ahead: usize = parts.next()?.parse().ok()?;
            Some((ahead, behind))
        })
        .unwrap_or((0, 0));

    let last_commit = read_last_commit(cwd);

    Some(GitStatus {
        branch,
        head_short,
        head_full,
        is_dirty,
        dirty_count,
        ahead,
        behind,
        upstream,
        last_commit,
    })
}

/// Short hash of HEAD. Used for stamping logs when launching a service.
pub fn current_commit_short(cwd: &Path) -> Option<String> {
    if !is_repo(cwd) {
        return None;
    }
    run_git(cwd, &["rev-parse", "--short", "HEAD"])
        .ok()
        .and_then(|(ok, out, _)| {
            if ok {
                Some(out.trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
}

/// List local branch names, sorted by last committed-to (most recent first).
pub fn list_branches(cwd: &Path) -> AppResult<Vec<String>> {
    if !is_repo(cwd) {
        return Ok(vec![]);
    }
    let (ok, out, err) = run_git(
        cwd,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads/",
        ],
    )?;
    if !ok {
        return Err(AppError::Other(format!("git for-each-ref failed: {err}")));
    }
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Checkout an existing local branch. Fails if the working tree would be
/// clobbered — we pass on git's own error message in that case.
pub fn checkout(cwd: &Path, branch: &str) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["checkout", branch])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git checkout {branch} failed: {}",
            err.trim()
        )))
    }
}

/// Create a new local branch from the current HEAD and switch to it. We
/// delegate name validation to git itself so invalid refs surface with the
/// exact message the user would see in a terminal.
pub fn create_branch(cwd: &Path, name: &str) -> AppResult<()> {
    require_repo(cwd)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("branch name is required".into()));
    }
    let (ok, _, err) = run_git(cwd, &["checkout", "-b", trimmed])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git checkout -b {trimmed} failed: {}",
            err.trim()
        )))
    }
}

/// `git fetch --all --prune`.
pub fn fetch(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git_with_timeout(cwd, &["fetch", "--all", "--prune"], FETCH_TIMEOUT)?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!("git fetch failed: {}", err.trim())))
    }
}

/// `git pull --ff-only`. Refuses to pull when the branch would need a merge,
/// which mirrors the safest-possible default for a one-click action.
pub fn pull(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git_with_timeout(cwd, &["pull", "--ff-only"], FETCH_TIMEOUT)?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!("git pull failed: {}", err.trim())))
    }
}

/// Pop the most recent stash back onto the working tree. Fails when the
/// stash stack is empty or when popping would cause a merge conflict — git's
/// own message is passed on verbatim so the UI can show exactly why.
pub fn stash_pop(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["stash", "pop"])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git stash pop failed: {}",
            err.trim()
        )))
    }
}

/// Undo the last commit while preserving the working tree and keeping the
/// changes staged. Equivalent to `git reset --soft HEAD~1`. This is the
/// safest form of "uncommit" — no file contents are lost, and the user can
/// immediately re-commit with a corrected message or additional changes.
pub fn undo_last_commit(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["reset", "--soft", "HEAD~1"])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git reset --soft HEAD~1 failed: {}",
            err.trim()
        )))
    }
}

/// Rewrite the last commit's message in place. The tree is taken from the
/// current HEAD plus whatever is staged — same semantics as a plain
/// `git commit --amend -m`. Safe on unpushed commits; if the commit was
/// already pushed the user will need to force-push, which we deliberately
/// don't expose.
pub fn amend_commit_message(cwd: &Path, message: &str) -> AppResult<()> {
    require_repo(cwd)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("commit message is required".into()));
    }
    let (ok, _, err) = run_git(cwd, &["commit", "--amend", "-m", trimmed])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git commit --amend failed: {}",
            err.trim()
        )))
    }
}

/// `git stash push [-m <msg>] --include-untracked`.
pub fn stash(cwd: &Path, message: Option<&str>) -> AppResult<()> {
    require_repo(cwd)?;
    let mut args: Vec<String> = vec!["stash".into(), "push".into(), "--include-untracked".into()];
    if let Some(m) = message {
        if !m.is_empty() {
            args.push("-m".into());
            args.push(m.to_string());
        }
    }
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (ok, _, err) = run_git(cwd, &args_ref)?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!("git stash failed: {}", err.trim())))
    }
}

// ---- Diff ----------------------------------------------------------------

pub fn diff(cwd: &Path) -> AppResult<DiffSummary> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff", "--stat", "--numstat"])?;
    if !ok {
        return Ok(DiffSummary {
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
        });
    }
    Ok(parse_diff_numstat(&out, false))
}

pub fn diff_staged(cwd: &Path) -> AppResult<DiffSummary> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff", "--staged", "--stat", "--numstat"])?;
    if !ok {
        return Ok(DiffSummary {
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
        });
    }
    Ok(parse_diff_numstat(&out, true))
}

pub fn diff_file(cwd: &Path, file: &str) -> AppResult<String> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff", "--", file])?;
    if ok {
        Ok(out)
    } else {
        Err(AppError::Other(format!("git diff -- {file} failed")))
    }
}

pub fn diff_file_staged(cwd: &Path, file: &str) -> AppResult<String> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff", "--staged", "--", file])?;
    if ok {
        Ok(out)
    } else {
        Err(AppError::Other(format!(
            "git diff --staged -- {file} failed"
        )))
    }
}

pub fn diff_branches(cwd: &Path, base: &str, head: &str) -> AppResult<DiffSummary> {
    require_repo(cwd)?;
    let range = format!("{base}...{head}");
    let (ok, out, _) = run_git(cwd, &["diff", "--stat", "--numstat", &range])?;
    if !ok {
        return Ok(DiffSummary {
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
        });
    }
    Ok(parse_diff_numstat(&out, false))
}

pub fn diff_all_raw(cwd: &Path) -> AppResult<String> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff"])?;
    if ok {
        Ok(out)
    } else {
        Ok(String::new())
    }
}

pub fn diff_staged_raw(cwd: &Path) -> AppResult<String> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(cwd, &["diff", "--staged"])?;
    if ok {
        Ok(out)
    } else {
        Ok(String::new())
    }
}

fn parse_diff_numstat(out: &str, _staged: bool) -> DiffSummary {
    let mut files = Vec::new();
    let mut total_additions = 0usize;
    let mut total_deletions = 0usize;

    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let adds: usize = if parts[0] == "-" {
            0
        } else {
            parts[0].parse().unwrap_or(0)
        };
        let dels: usize = if parts[1] == "-" {
            0
        } else {
            parts[1].parse().unwrap_or(0)
        };
        let path = parts[2].to_string();
        let status = if adds > 0 && dels == 0 {
            FileDiffStatus::Added
        } else if adds == 0 && dels > 0 {
            FileDiffStatus::Deleted
        } else {
            FileDiffStatus::Modified
        };
        total_additions += adds;
        total_deletions += dels;
        files.push(FileDiff {
            path,
            status,
            additions: adds,
            deletions: dels,
        });
    }

    DiffSummary {
        files,
        total_additions,
        total_deletions,
    }
}

// ---- internals ------------------------------------------------------------

/// Upper bound for network-touching operations (fetch, pull). Without this a
/// stalled remote (SSH hang, VPN drop) would leave the UI spinner forever.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

fn require_repo(cwd: &Path) -> AppResult<()> {
    if is_repo(cwd) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "not a git repository: {}",
            cwd.display()
        )))
    }
}

fn read_last_commit(cwd: &Path) -> Option<CommitInfo> {
    // Use \x1f (unit separator) as the field separator so commit messages
    // containing newlines or tabs don't break parsing.
    let (ok, out, _) = run_git(
        cwd,
        &[
            "log",
            "-1",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%s%x1f%ct",
        ],
    )
    .ok()?;
    if !ok {
        return None;
    }
    let mut parts = out.split('\x1f');
    Some(CommitInfo {
        hash_full: parts.next()?.trim().to_string(),
        hash_short: parts.next()?.trim().to_string(),
        author: parts.next()?.trim().to_string(),
        email: parts.next()?.trim().to_string(),
        subject: parts.next()?.trim().to_string(),
        timestamp: parts.next()?.trim().parse().ok()?,
    })
}

/// Environment variables that redirect git to a specific repo/index. If the
/// parent process is itself running inside a git operation (a git hook, a
/// rebase, `git commit` invoking this binary, etc.) these will be set and
/// would cause every git call we make here to target the parent's repo
/// rather than our `cwd`. Always clear them for a clean isolation boundary.
const LEAKY_GIT_ENV: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_INTERNAL_GETTEXT_TEST_FALLBACKS",
];

fn configure_git_cmd(cmd: &mut Command, cwd: &Path) {
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Keep git's own output stable regardless of the user's locale.
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    for var in LEAKY_GIT_ENV {
        cmd.env_remove(var);
    }
}

/// Run `git` in `cwd`. Returns `(success, stdout, stderr)`.
///
/// We deliberately swallow invocation failures (git not installed) into an
/// `Err` so callers can surface a clean "git unavailable" message instead of
/// a raw `std::io::Error`.
fn run_git(cwd: &Path, args: &[&str]) -> AppResult<(bool, String, String)> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    configure_git_cmd(&mut cmd, cwd);
    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("failed to invoke git: {e}")))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

#[cfg(unix)]
fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> AppResult<(bool, String, String)> {
    use std::io::Read;

    let mut cmd = Command::new("git");
    cmd.args(args);
    configure_git_cmd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to invoke git: {e}")))?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut stdout);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut stderr);
                }
                return Ok((status.success(), stdout, stderr));
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err(AppError::Other(format!(
                        "git {} timed out after {:?}",
                        args.join(" "),
                        timeout
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(AppError::Other(format!("git wait failed: {e}"))),
        }
    }
}

#[cfg(not(unix))]
fn run_git_with_timeout(
    cwd: &Path,
    args: &[&str],
    _timeout: Duration,
) -> AppResult<(bool, String, String)> {
    // Windows timeout support would need a job object or a watcher thread;
    // we fall back to a plain blocking run since the UI already surfaces
    // long-running operations via a spinner.
    run_git(cwd, args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_repo(dir: &Path) {
        run_git(dir, &["init", "-q", "-b", "main"]).unwrap();
        run_git(dir, &["config", "user.email", "t@t.test"]).unwrap();
        run_git(dir, &["config", "user.name", "t"]).unwrap();
        run_git(dir, &["config", "commit.gpgsign", "false"]).unwrap();
    }

    fn write_file(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn non_repo_returns_none() {
        let td = tempfile::tempdir().unwrap();
        assert!(!is_repo(td.path()));
        assert!(status(td.path()).is_none());
        assert!(current_commit_short(td.path()).is_none());
        assert_eq!(list_branches(td.path()).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn status_clean_after_commit() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();

        let s = status(td.path()).expect("repo");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert!(!s.is_dirty);
        assert_eq!(s.dirty_count, 0);
        assert_eq!(s.ahead, 0);
        assert_eq!(s.behind, 0);
        assert!(s.upstream.is_none());
        assert!(s.head_full.is_some());
        assert_eq!(s.head_short.as_ref().unwrap().len(), 7);
        let lc = s.last_commit.unwrap();
        assert_eq!(lc.subject, "initial");
        assert!(!lc.author.is_empty());
    }

    #[test]
    fn status_dirty_after_change() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "a.txt", "changed");

        let s = status(td.path()).unwrap();
        assert!(s.is_dirty);
        assert_eq!(s.dirty_count, 1);
    }

    #[test]
    fn status_dirty_includes_untracked() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "new.txt", "untracked");

        let s = status(td.path()).unwrap();
        assert!(s.is_dirty);
        assert_eq!(s.dirty_count, 1);
    }

    #[test]
    fn list_branches_returns_locals() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        run_git(td.path(), &["branch", "feature"]).unwrap();
        let mut b = list_branches(td.path()).unwrap();
        b.sort();
        assert_eq!(b, vec!["feature".to_string(), "main".to_string()]);
    }

    #[test]
    fn create_branch_switches_to_new() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        create_branch(td.path(), "topic").unwrap();
        let s = status(td.path()).unwrap();
        assert_eq!(s.branch.as_deref(), Some("topic"));
    }

    #[test]
    fn create_branch_rejects_empty() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        assert!(create_branch(td.path(), "   ").is_err());
    }

    #[test]
    fn checkout_switches_branch() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        run_git(td.path(), &["branch", "feature"]).unwrap();
        checkout(td.path(), "feature").unwrap();
        let s = status(td.path()).unwrap();
        assert_eq!(s.branch.as_deref(), Some("feature"));
    }

    #[test]
    fn stash_then_pop_restores_working_tree() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "a.txt", "changed");

        stash(td.path(), Some("wip")).unwrap();
        let s = status(td.path()).unwrap();
        assert!(!s.is_dirty, "stash should have cleaned the tree");

        stash_pop(td.path()).unwrap();
        let s = status(td.path()).unwrap();
        assert!(s.is_dirty, "pop should have reapplied the change");
        assert_eq!(
            std::fs::read_to_string(td.path().join("a.txt")).unwrap(),
            "changed"
        );
    }

    #[test]
    fn stash_pop_errors_when_empty() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        assert!(stash_pop(td.path()).is_err());
    }

    #[test]
    fn undo_last_commit_keeps_changes_staged() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "b.txt", "second");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "second"]).unwrap();

        undo_last_commit(td.path()).unwrap();
        let s = status(td.path()).unwrap();
        // HEAD is now back at 'initial', but b.txt is still staged so the
        // tree shows as dirty — that's the whole point of --soft.
        assert_eq!(s.last_commit.unwrap().subject, "initial");
        assert!(s.is_dirty);
    }

    #[test]
    fn undo_last_commit_errors_on_single_commit() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        // HEAD~1 doesn't exist — git errors and we propagate it.
        assert!(undo_last_commit(td.path()).is_err());
    }

    #[test]
    fn amend_commit_message_rewrites_subject() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "typo"]).unwrap();

        amend_commit_message(td.path(), "fix: proper subject").unwrap();
        let s = status(td.path()).unwrap();
        assert_eq!(s.last_commit.unwrap().subject, "fix: proper subject");
    }

    #[test]
    fn amend_commit_message_rejects_empty() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        assert!(amend_commit_message(td.path(), "   ").is_err());
    }

    #[test]
    fn diff_clean_repo_returns_empty() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        let d = diff(td.path()).unwrap();
        assert!(d.files.is_empty());
        assert_eq!(d.total_additions, 0);
        assert_eq!(d.total_deletions, 0);
    }

    #[test]
    fn diff_dirty_repo_returns_files() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "a.txt", "changed content");
        let d = diff(td.path()).unwrap();
        assert!(!d.files.is_empty());
        assert_eq!(d.files[0].path, "a.txt");
    }

    #[test]
    fn diff_staged_returns_only_staged() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "b.txt", "new file");
        run_git(td.path(), &["add", "."]).unwrap();
        let d = diff_staged(td.path()).unwrap();
        assert!(!d.files.is_empty());
    }

    #[test]
    fn diff_file_returns_raw_diff() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello\n");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "a.txt", "world\n");
        let raw = diff_file(td.path(), "a.txt").unwrap();
        assert!(raw.contains("-hello"));
        assert!(raw.contains("+world"));
    }

    #[test]
    fn diff_branches_compares() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello\n");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        run_git(td.path(), &["checkout", "-b", "feature"]).unwrap();
        write_file(td.path(), "b.txt", "new\n");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "add b"]).unwrap();
        let d = diff_branches(td.path(), "main", "feature").unwrap();
        assert!(!d.files.is_empty());
    }
}
