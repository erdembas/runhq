//! Persistent dependency-scan results.
//!
//! Stores the latest successful dependency scan per service in SQLite so the
//! dashboard can hydrate from disk before an expensive rescan completes.

mod db;
mod types;

#[cfg(test)]
mod tests;

pub use db::ScanHistoryDb;
pub use types::PersistedScan;
