use std::path::Path;

use crate::error::{AppError, AppResult};

use super::runner::{require_repo, run_git, run_git_with_timeout, FETCH_TIMEOUT};

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
