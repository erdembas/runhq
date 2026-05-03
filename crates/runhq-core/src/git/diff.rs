use std::path::Path;

use crate::error::{AppError, AppResult};

use super::runner::{require_repo, run_git};
use super::types::{DiffSummary, FileDiff, FileDiffStatus};

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

pub(super) fn parse_diff_numstat(out: &str, _staged: bool) -> DiffSummary {
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
