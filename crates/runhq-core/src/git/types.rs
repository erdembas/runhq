use serde::Serialize;

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
