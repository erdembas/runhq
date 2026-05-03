//! Lightweight git integration built on top of the `git` CLI.
//!
//! We shell out rather than linking libgit2 to keep the core crate's build
//! surface small and portable — RunHQ targets local developer machines where
//! `git` is already installed, so the tradeoff is an easy win. All functions
//! are no-ops (returning `None` / empty data) when the path is not inside a
//! working tree, so callers can treat "not a git repo" as the normal case.

mod branch;
mod diff;
mod history;
mod runner;
mod status;
mod types;
mod working_tree;

pub use branch::{
    checkout, create_branch, delete_branch, fetch, list_branches, list_remote_branches, pull,
};
pub use diff::{
    diff, diff_all_raw, diff_branches, diff_file, diff_file_staged, diff_staged, diff_staged_raw,
};
pub use history::{diff_commit_file, log, show_commit, CommitSummary};
pub use status::{current_commit_short, is_repo, status};
pub use types::{CommitInfo, DiffSummary, FileDiff, FileDiffStatus, GitStatus};
pub use working_tree::{
    amend_commit_message, commit, discard_file, push, stage_all, stage_file, stash, stash_pop,
    undo_last_commit, unstage_all, unstage_file,
};

#[cfg(test)]
mod tests;
