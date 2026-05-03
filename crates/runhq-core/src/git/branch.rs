use std::path::Path;

use crate::error::{AppError, AppResult};

use super::runner::{require_repo, run_git, run_git_with_timeout, FETCH_TIMEOUT};
use super::status::is_repo;

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
