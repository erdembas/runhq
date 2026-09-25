//! Data-only package format used by native Workflow import.
//! This module validates manifests and reads bounded JSON/ZIP assets. Execution belongs entirely
//! to AgentWorkflow, including approvals, scheduling, retries and repository snapshots.
use super::*;
mod types;
pub use types::*;
mod condition;
pub(super) mod import;
#[cfg(test)]
mod tests;
