//! Cross-project overview and aggregation.
//!
//! Provides a bird's-eye view across all registered services — git status,
//! resource sampling, last-activity detection, and optional dependency /
//! security scans.
//!
//! # Two-phase design
//!
//! Opening the dashboard should feel instant. But `npm outdated` / `cargo
//! audit` each routinely take 5–30 s per project, so running them inline
//! blocks the UI for minutes on a large workspace. The API is therefore
//! split in two:
//!
//! * [`gather_overview`] — **fast path**. Git status, process resource
//!   samples, staleness, and tags, all in-memory or trivial filesystem
//!   reads. Returns in ~tens of ms for typical sizes.
//! * [`gather_dependency_scan`] — **slow path**, opt-in. Spawns the
//!   `npm outdated` / `cargo outdated` / `npm audit` / ... commands in
//!   parallel with a hard timeout each, and memoises the result in a
//!   TTL cache so subsequent opens are instant.
//!
//! The frontend calls `gather_overview` on open and only triggers
//! `gather_dependency_scan` when the user explicitly clicks "Scan
//! dependencies" (or on an interval if they want).

mod cache;
mod checks;
mod dependency_scan;
mod runtime;
mod summary;
mod time;
mod types;

pub use dependency_scan::{
    gather_dependency_scan, gather_dependency_scan_for_service, gather_dependency_scan_with_history,
};
pub use summary::{gather_overview, gather_overview_with_history};
pub use types::*;

#[cfg(test)]
mod tests;
