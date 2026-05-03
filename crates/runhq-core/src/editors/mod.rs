//! Editor detection and launch.
//!
//! Scans the system for known code editors and provides a cross-platform
//! `open_in_editor` function that spawns the editor pointing at a path.

mod catalog;
mod detection;
mod launch;
mod paths;
mod resolver;
mod types;

#[cfg(test)]
mod tests;

pub use detection::detect_editors;
pub use launch::open_in_editor;
pub use types::DetectedEditor;
