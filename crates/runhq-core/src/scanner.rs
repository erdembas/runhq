//! Project discovery via pluggable runtime providers.
//!
//! Adding a new provider (e.g. Go, .NET, Python) means implementing
//! [`RuntimeProvider`] and registering it in [`providers::all`]. Providers
//! return _suggestions_, not decisions — the UI always asks the user to confirm.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppResult;

mod helpers;
mod providers;

pub(crate) use helpers::has_file_pattern;

const MAX_DEPTH: usize = 4;
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    ".git",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    "bin",
    "obj",
    ".gradle",
    ".mvn",
    ".idea",
    ".vscode",
    "vendor",
    ".cargo",
    "pkg",
];

#[derive(Debug, Clone, Serialize)]
pub struct ProjectCandidate {
    pub name: String,
    pub cwd: PathBuf,
    pub runtime: &'static str,
    pub suggestions: Vec<Suggestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub label: String,
    pub cmd: String,
}

pub trait RuntimeProvider: Sync + Send {
    fn label(&self) -> &'static str;
    fn detect(&self, dir: &Path) -> Option<ProjectCandidate>;
}

fn providers() -> Vec<Box<dyn RuntimeProvider>> {
    providers::all()
}

/// Recursively scan `root`, walking up to [`MAX_DEPTH`] directories deep.
pub fn scan(root: &Path) -> AppResult<Vec<ProjectCandidate>> {
    let providers = providers();
    let mut out = Vec::new();
    walk(root, 0, &providers, &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert(c.cwd.clone()));
    Ok(out)
}

/// Detect a project in a single directory, _without_ walking children.
pub fn detect_one(dir: &Path) -> AppResult<Option<ProjectCandidate>> {
    if !dir.is_dir() {
        return Ok(None);
    }
    for provider in providers() {
        if let Some(candidate) = provider.detect(dir) {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

fn walk(
    dir: &Path,
    depth: usize,
    providers: &[Box<dyn RuntimeProvider>],
    out: &mut Vec<ProjectCandidate>,
) {
    if depth > MAX_DEPTH || !dir.is_dir() {
        return;
    }
    for provider in providers {
        if let Some(candidate) = provider.detect(dir) {
            out.push(candidate);
        }
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') || IGNORED_DIRS.contains(&name) {
            continue;
        }
        walk(&path, depth + 1, providers, out);
    }
}

pub(super) fn dir_name(dir: &Path) -> String {
    dir.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unnamed")
        .to_string()
}
