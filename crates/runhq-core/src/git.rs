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

/// Per-file diff status.
///
/// The TypeScript side expects lowercase tags ("modified", "added", …)
/// but serde defaults to the variant's original casing. We lock the
/// wire format explicitly so the frontend `FileDiffStatus` union and
/// all the status-letter / colour maps keyed by it actually match the
/// JSON — without this, every `statusLetter[file.status]` lookup
/// returned `undefined` and the right-edge status indicators silently
/// disappeared.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
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

/// List remote-tracking branches (e.g. `origin/main`). Used in the branch
/// switcher's "Remote" tab so users can check out a remote branch directly.
pub fn list_remote_branches(cwd: &Path) -> AppResult<Vec<String>> {
    if !is_repo(cwd) {
        return Ok(vec![]);
    }
    let (ok, out, err) = run_git(
        cwd,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/remotes/",
        ],
    )?;
    if !ok {
        return Err(AppError::Other(format!("git for-each-ref failed: {err}")));
    }
    // `origin/HEAD -> origin/main` entries appear as "origin/HEAD"; skip
    // them because they're not real branches.
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
        .collect())
}

/// Delete a local branch. `force=false` uses `git branch -d` which refuses
/// to delete an unmerged branch — we surface that error verbatim so the UI
/// can offer a "force delete" follow-up with an explicit confirmation.
/// Cannot delete the currently checked-out branch; git will refuse.
pub fn delete_branch(cwd: &Path, name: &str, force: bool) -> AppResult<()> {
    require_repo(cwd)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("branch name is required".into()));
    }
    let flag = if force { "-D" } else { "-d" };
    let (ok, _, err) = run_git(cwd, &["branch", flag, trimmed])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git branch {flag} {trimmed} failed: {}",
            err.trim()
        )))
    }
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

/// Returns the raw unified diff for a single working-tree file.
///
/// `context` overrides git's default `-U3` when Some. Passing a very
/// large value (e.g. `99_999`) causes git to include every unchanged
/// line as context, effectively returning both sides of the file —
/// exactly what the diff editor needs for "Full file" rendering
/// mode where the reviewer wants to see unchanged code around the
/// hunks without any collapsed gaps.
pub fn diff_file(cwd: &Path, file: &str, context: Option<u32>) -> AppResult<String> {
    require_repo(cwd)?;
    let ctx_flag = context.map(|n| format!("-U{n}"));
    let mut args: Vec<&str> = vec!["diff"];
    if let Some(flag) = ctx_flag.as_deref() {
        args.push(flag);
    }
    args.push("--");
    args.push(file);
    let (ok, out, _) = run_git(cwd, &args)?;
    if ok {
        Ok(out)
    } else {
        Err(AppError::Other(format!("git diff -- {file} failed")))
    }
}

pub fn diff_file_staged(cwd: &Path, file: &str, context: Option<u32>) -> AppResult<String> {
    require_repo(cwd)?;
    let ctx_flag = context.map(|n| format!("-U{n}"));
    let mut args: Vec<&str> = vec!["diff", "--staged"];
    if let Some(flag) = ctx_flag.as_deref() {
        args.push(flag);
    }
    args.push("--");
    args.push(file);
    let (ok, out, _) = run_git(cwd, &args)?;
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

// ---- Staging / Commit ----------------------------------------------------

/// Stage a single path. `git add --` is used so paths that start with a dash
/// aren't mistaken for flags.
pub fn stage_file(cwd: &Path, path: &str) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["add", "--", path])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git add -- {path} failed: {}",
            err.trim()
        )))
    }
}

/// Unstage (`git reset HEAD -- <path>`). Works for both tracked and newly
/// added files; does not touch the working tree.
pub fn unstage_file(cwd: &Path, path: &str) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["reset", "HEAD", "--", path])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git reset HEAD -- {path} failed: {}",
            err.trim()
        )))
    }
}

/// Stage every modified, deleted, and untracked path under the working tree.
/// Equivalent to `git add -A`.
pub fn stage_all(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["add", "-A"])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git add -A failed: {}",
            err.trim()
        )))
    }
}

/// Unstage everything currently in the index. Equivalent to `git reset HEAD`.
pub fn unstage_all(cwd: &Path) -> AppResult<()> {
    require_repo(cwd)?;
    let (ok, _, err) = run_git(cwd, &["reset", "HEAD"])?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git reset HEAD failed: {}",
            err.trim()
        )))
    }
}

/// Throw away working-tree changes for a single path. Auto-detects whether
/// the path is tracked and routes to the safe equivalent:
///
/// * **Tracked + modified / deleted** — `git checkout HEAD -- <path>` to
///   restore the file from HEAD. The index is also reset for the path so
///   partial-stage states don't survive.
/// * **Untracked** — `git clean -f -- <path>`, which physically removes
///   the file from disk. The frontend MUST gate this with a typed-word
///   confirmation since it deletes data git never tracked.
///
/// Renamed files in the working tree are treated as the destination path
/// being modified — git itself stages the rename when the user wants it,
/// so the destination path's checkout is the right thing here.
///
/// IRREVERSIBLE for both branches; the caller is responsible for
/// confirmation UX.
pub fn discard_file(cwd: &Path, path: &str) -> AppResult<()> {
    require_repo(cwd)?;
    // `git ls-files --error-unmatch` is the canonical "is this path
    // tracked at HEAD/index" probe. Exit code 0 means tracked, non-zero
    // means untracked (or doesn't exist). We swallow stderr so the user
    // doesn't see the noisy "did not match any file(s)" message — that's
    // an expected branch of the routing logic, not an error.
    let (tracked, _, _) = run_git(cwd, &["ls-files", "--error-unmatch", "--", path])?;
    if tracked {
        // Reset the index entry for this path first so a partially-staged
        // file ends up fully clean rather than re-emerging as "Staged" on
        // the next refresh. We tolerate a failure here because reset
        // emits non-zero on paths that aren't in the index, which is
        // fine — the checkout below is what matters.
        let _ = run_git(cwd, &["reset", "HEAD", "--", path])?;
        let (ok, _, err) = run_git(cwd, &["checkout", "HEAD", "--", path])?;
        if ok {
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "git checkout HEAD -- {path} failed: {}",
                err.trim()
            )))
        }
    } else {
        // Untracked path → `git clean` is the git-aware way to remove
        // it. Using `-f` is required (clean refuses without it) and
        // `-d` lets it remove empty parent directories that became
        // empty as a result of the file removal.
        let (ok, _, err) = run_git(cwd, &["clean", "-f", "-d", "--", path])?;
        if ok {
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "git clean -f -d -- {path} failed: {}",
                err.trim()
            )))
        }
    }
}

/// Create a new commit from whatever is currently staged. When `amend` is
/// true the previous commit is rewritten instead — safe pre-push, dangerous
/// after a push. The caller is responsible for that policy.
pub fn commit(cwd: &Path, message: &str, amend: bool) -> AppResult<()> {
    require_repo(cwd)?;
    let trimmed = message.trim();
    if trimmed.is_empty() && !amend {
        return Err(AppError::Invalid("commit message is required".into()));
    }
    let mut args: Vec<&str> = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    if !trimmed.is_empty() {
        args.push("-m");
        args.push(trimmed);
    } else {
        // Amend with no new message keeps the original.
        args.push("--no-edit");
    }
    let (ok, _, err) = run_git(cwd, &args)?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "git commit failed: {}",
            err.trim()
        )))
    }
}

/// Push the current branch to its upstream. `force_with_lease` is the safer
/// form of force-push — it refuses to overwrite remote history that the
/// local repo hasn't observed. We never expose plain `--force`.
pub fn push(cwd: &Path, force_with_lease: bool) -> AppResult<()> {
    require_repo(cwd)?;
    let mut args: Vec<&str> = vec!["push"];
    if force_with_lease {
        args.push("--force-with-lease");
    }
    let (ok, _, err) = run_git_with_timeout(cwd, &args, FETCH_TIMEOUT)?;
    if ok {
        Ok(())
    } else {
        Err(AppError::Other(format!("git push failed: {}", err.trim())))
    }
}

// ---- History -------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommitSummary {
    pub hash_full: String,
    pub hash_short: String,
    /// Parent hashes (full). First entry is the first parent. Merge commits
    /// have >1 entries; root commits have 0.
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub subject: String,
    /// Author time, Unix epoch seconds.
    pub timestamp: i64,
    /// Branch / tag refs that point at this commit (e.g. `HEAD -> main`,
    /// `origin/main`, `tag: v1.0`). Formatted the way `git log --decorate`
    /// emits them.
    pub refs: Vec<String>,
}

/// Read commit history as a flat list. `branch` is optional — when `None`
/// the log follows HEAD; otherwise the given ref. `limit` caps how many
/// commits we return (the UI paginates on top). Parents are included so
/// the frontend can draw a graph without a second round-trip.
pub fn log(cwd: &Path, branch: Option<&str>, limit: usize) -> AppResult<Vec<CommitSummary>> {
    require_repo(cwd)?;
    let limit_str = limit.max(1).to_string();
    let mut args: Vec<&str> = vec![
        "log",
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%s%x1f%ct%x1f%D",
        "-n",
        &limit_str,
    ];
    if let Some(b) = branch {
        if !b.is_empty() {
            args.push(b);
        }
    }
    let (ok, out, err) = run_git(cwd, &args)?;
    if !ok {
        // Fresh repo with no commits yet — not an error from the UI's POV.
        let trimmed = err.trim();
        if trimmed.contains("does not have any commits yet")
            || trimmed.contains("unknown revision")
            || trimmed.contains("bad default revision")
            || trimmed.contains("ambiguous argument")
        {
            return Ok(Vec::new());
        }
        return Err(AppError::Other(format!("git log failed: {trimmed}")));
    }
    let mut commits = Vec::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(8, '\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        let parents: Vec<String> = parts[2].split_whitespace().map(|s| s.to_string()).collect();
        let refs_raw = parts.get(7).copied().unwrap_or("").trim();
        let refs: Vec<String> = if refs_raw.is_empty() {
            Vec::new()
        } else {
            refs_raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };
        commits.push(CommitSummary {
            hash_full: parts[0].to_string(),
            hash_short: parts[1].to_string(),
            parents,
            author: parts[3].to_string(),
            email: parts[4].to_string(),
            subject: parts[5].to_string(),
            timestamp: parts[6].parse().unwrap_or(0),
            refs,
        });
    }
    Ok(commits)
}

/// `git show` for a single commit rendered as a diff summary (numstat). The
/// first parent is used for merge commits — that's what most Git UIs do
/// when rendering a merge's "changes" view.
pub fn show_commit(cwd: &Path, hash: &str) -> AppResult<DiffSummary> {
    require_repo(cwd)?;
    let (ok, out, _) = run_git(
        cwd,
        &[
            "show",
            "--stat",
            "--numstat",
            "--format=",
            "-m",
            "--first-parent",
            hash,
        ],
    )?;
    if !ok {
        return Ok(DiffSummary {
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
        });
    }
    Ok(parse_diff_numstat(&out, false))
}

/// Raw unified diff for a single file in a commit (vs. its first parent).
/// See `diff_file` for how `context` affects the output.
///
/// Merge commits are the subtle case: the obvious-looking `<hash>^!`
/// shorthand expands (per `gitrevisions`) to "the rev minus *all* its
/// parents". For a merge with two parents that's `A ^A^1 ^A^2` — i.e.
/// only the lines A introduced that don't appear in *either* parent
/// (the conflict-resolution diff). For a clean fast-forward-style
/// merge that's an empty patch, even though `git show -m
/// --first-parent` over the same commit lists changed files
/// (`show_commit` does exactly that for the file-tree pane). The
/// result was the History panel rendering "this merge changed N
/// files" but the per-file diff coming back blank.
///
/// We instead diff explicitly against the first parent
/// (`<hash>^1..<hash>`), which:
///   - for a normal commit: same as `^!` (single parent),
///   - for a merge commit: gives the mainline view — what the merge
///     *brought in* from the second parent. This matches GitHub /
///     GitLab / VSCode / `git log --first-parent -p` semantics.
///
/// The initial-commit case (no parent) still errors here; callers
/// already handle it by falling back to `git diff-tree --root`
/// elsewhere, so we don't paper over it silently.
pub fn diff_commit_file(
    cwd: &Path,
    hash: &str,
    file: &str,
    context: Option<u32>,
) -> AppResult<String> {
    require_repo(cwd)?;
    let range = format!("{hash}^1..{hash}");
    let ctx_flag = context.map(|n| format!("-U{n}"));
    let mut args: Vec<&str> = vec!["diff"];
    if let Some(flag) = ctx_flag.as_deref() {
        args.push(flag);
    }
    args.push(&range);
    args.push("--");
    args.push(file);
    let (ok, out, err) = run_git(cwd, &args)?;
    if ok {
        Ok(out)
    } else {
        Err(AppError::Other(format!(
            "git diff {range} -- {file} failed: {}",
            err.trim()
        )))
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
    fn delete_branch_removes_merged_branch() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        run_git(td.path(), &["branch", "feature"]).unwrap();
        delete_branch(td.path(), "feature", false).unwrap();
        let b = list_branches(td.path()).unwrap();
        assert!(!b.iter().any(|n| n == "feature"));
    }

    #[test]
    fn delete_branch_refuses_unmerged_without_force() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        run_git(td.path(), &["checkout", "-b", "feature"]).unwrap();
        write_file(td.path(), "b.txt", "wip");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "wip"]).unwrap();
        // switch back so we can delete `feature`
        run_git(td.path(), &["checkout", "-q", "main"]).unwrap();
        assert!(delete_branch(td.path(), "feature", false).is_err());
        // force succeeds
        delete_branch(td.path(), "feature", true).unwrap();
        let b = list_branches(td.path()).unwrap();
        assert!(!b.iter().any(|n| n == "feature"));
    }

    #[test]
    fn delete_branch_rejects_empty_name() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        assert!(delete_branch(td.path(), "  ", false).is_err());
    }

    #[test]
    fn list_remote_branches_empty_when_no_remote() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        let r = list_remote_branches(td.path()).unwrap();
        assert!(r.is_empty());
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
        let raw = diff_file(td.path(), "a.txt", None).unwrap();
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

    #[test]
    fn stage_then_commit_creates_commit() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        // Seed commit so HEAD exists and log has something.
        write_file(td.path(), "a.txt", "hello\n");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();

        // Unstaged change.
        write_file(td.path(), "a.txt", "world\n");
        assert!(!diff(td.path()).unwrap().files.is_empty());
        assert!(diff_staged(td.path()).unwrap().files.is_empty());

        // Stage and commit via our wrappers.
        stage_file(td.path(), "a.txt").unwrap();
        assert!(!diff_staged(td.path()).unwrap().files.is_empty());
        assert!(diff(td.path()).unwrap().files.is_empty());
        commit(td.path(), "update a", false).unwrap();

        let commits = log(td.path(), None, 10).unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "update a");
        assert_eq!(commits[0].parents.len(), 1);
    }

    #[test]
    fn unstage_file_moves_back_to_working_tree() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello\n");
        run_git(td.path(), &["add", "."]).unwrap();
        run_git(td.path(), &["commit", "-q", "-m", "initial"]).unwrap();
        write_file(td.path(), "a.txt", "world\n");
        stage_file(td.path(), "a.txt").unwrap();
        assert!(!diff_staged(td.path()).unwrap().files.is_empty());
        unstage_file(td.path(), "a.txt").unwrap();
        assert!(diff_staged(td.path()).unwrap().files.is_empty());
        assert!(!diff(td.path()).unwrap().files.is_empty());
    }

    #[test]
    fn commit_rejects_empty_message() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "hello\n");
        stage_all(td.path()).unwrap();
        let res = commit(td.path(), "   ", false);
        assert!(res.is_err());
    }

    #[test]
    fn log_on_empty_repo_returns_empty_list() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        // No commits yet.
        let commits = log(td.path(), None, 10).unwrap();
        assert!(commits.is_empty());
    }

    #[test]
    fn show_commit_returns_numstat() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        write_file(td.path(), "a.txt", "one\n");
        stage_all(td.path()).unwrap();
        commit(td.path(), "first", false).unwrap();
        write_file(td.path(), "a.txt", "one\ntwo\n");
        write_file(td.path(), "b.txt", "hi\n");
        stage_all(td.path()).unwrap();
        commit(td.path(), "second", false).unwrap();

        let commits = log(td.path(), None, 10).unwrap();
        let head = &commits[0];
        let d = show_commit(td.path(), &head.hash_full).unwrap();
        assert_eq!(d.files.len(), 2);
        let raw = diff_commit_file(td.path(), &head.hash_full, "a.txt", None).unwrap();
        assert!(raw.contains("+two"));
    }

    /// Regression: a non-conflicting merge commit used to come back
    /// with an empty per-file diff because we used `<hash>^!`, which
    /// excludes *all* parents. The History panel then rendered the
    /// merge as "files changed: N" with blank diff panes (the user
    /// reported "merge commit'de diff olmaması normal mi?"). With
    /// the `<hash>^1..<hash>` range we now show the mainline diff
    /// — what the merge *brought in* from the second parent.
    #[test]
    fn diff_commit_file_handles_clean_merge() {
        let td = tempfile::tempdir().unwrap();
        init_repo(td.path());
        // base commit on main
        write_file(td.path(), "a.txt", "one\n");
        stage_all(td.path()).unwrap();
        commit(td.path(), "init", false).unwrap();
        // branch off and add a file with no overlap on main
        run_git(td.path(), &["checkout", "-q", "-b", "feature"]).unwrap();
        write_file(td.path(), "feat.txt", "hello\nworld\n");
        stage_all(td.path()).unwrap();
        commit(td.path(), "feat: add feat.txt", false).unwrap();
        // back to main, merge feature with --no-ff so we get a real
        // merge commit (otherwise it'd fast-forward and not be a
        // merge at all).
        run_git(td.path(), &["checkout", "-q", "main"]).unwrap();
        let (ok, _, err) = run_git(
            td.path(),
            &["merge", "--no-ff", "--no-edit", "-q", "feature"],
        )
        .unwrap();
        assert!(ok, "merge failed: {err}");

        let commits = log(td.path(), None, 10).unwrap();
        let merge_commit = &commits[0];
        // sanity: the merge brought in feat.txt
        let summary = show_commit(td.path(), &merge_commit.hash_full).unwrap();
        assert!(
            summary.files.iter().any(|f| f.path == "feat.txt"),
            "show_commit didn't list feat.txt for the merge: {:?}",
            summary.files
        );
        // The thing the previous implementation got wrong: for a
        // clean merge the per-file diff was empty. Now it should
        // contain the inserted lines.
        let raw = diff_commit_file(td.path(), &merge_commit.hash_full, "feat.txt", None).unwrap();
        assert!(
            raw.contains("+hello") && raw.contains("+world"),
            "expected per-file merge diff to include the merged-in lines, got:\n{raw}"
        );
    }
}
