//! Activity timeline tracking and persistence.
//!
//! Records developer activity across projects and provides daily summaries
//! plus standup export.

mod db;
mod types;

#[cfg(test)]
mod tests;

pub use db::TimelineDb;
pub use types::{DailySummary, TimelineEvent, TimelineEventType};
