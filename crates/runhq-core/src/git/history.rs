use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

use super::diff::parse_diff_numstat;
use super::runner::{require_repo, run_git};
use super::types::DiffSummary;

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
