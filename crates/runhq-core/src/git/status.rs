use std::path::{Path, PathBuf};

use crate::{AppError, AppResult};

use super::runner::{read_last_commit, run_git};
use super::types::GitStatus;

/// Canonical shared Git directory, including when `cwd` is a subdirectory,
/// symlink, or linked worktree. Mutations that share refs use the same gate.
pub fn common_directory(cwd: &Path) -> AppResult<PathBuf> {
    let (ok, output, error) = run_git(cwd, &["rev-parse", "--git-common-dir"])?;
    if !ok || output.trim().is_empty() {
        return Err(AppError::Invalid(format!(
            "not a git repository: {} ({})",
            cwd.display(),
            error.trim(),
        )));
    }
    Ok(cwd.join(output.trim()).canonicalize()?)
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
