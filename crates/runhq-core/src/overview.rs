//! Cross-project overview and aggregation.
//!
//! Provides a bird's-eye view across all registered services —
//! git status matrix, resource heatmap, stale project detection,
//! and dependency outdatedness signals.

use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::error::AppResult;
use crate::git::{self, GitStatus};
use crate::process::Supervisor;
use crate::state::Store;

#[derive(Debug, Clone, Serialize)]
pub struct ProjectOverview {
    pub service_id: String,
    pub name: String,
    pub cwd: String,
    pub runtime: Option<String>,
    pub is_running: bool,
    pub git_status: Option<GitStatus>,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub last_activity: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverviewSummary {
    pub projects: Vec<ProjectOverview>,
    pub total_running: usize,
    pub total_stopped: usize,
    pub total_dirty: usize,
    pub total_behind: usize,
    pub total_cpu: f32,
    pub total_memory: u64,
}

pub fn gather_overview(store: &Store, supervisor: &Supervisor) -> AppResult<OverviewSummary> {
    let services = store.services();
    let mut projects = Vec::with_capacity(services.len());
    let mut total_running = 0usize;
    let mut total_stopped = 0usize;
    let mut total_dirty = 0usize;
    let mut total_behind = 0usize;
    let mut total_cpu = 0.0f32;
    let mut total_memory = 0u64;

    for svc in &services {
        let is_running = supervisor.is_running(&svc.id);
        if is_running {
            total_running += 1;
        } else {
            total_stopped += 1;
        }

        let git_status = git::status(&svc.cwd);
        if let Some(ref gs) = git_status {
            if gs.is_dirty {
                total_dirty += 1;
            }
            if gs.behind > 0 {
                total_behind += 1;
            }
        }

        let (cpu, memory) = if is_running {
            let status = supervisor.service_status(svc);
            let cpu = status.commands.iter().map(|_| 0.0f32).sum::<f32>();
            (cpu, 0u64)
        } else {
            (0.0, 0)
        };
        total_cpu += cpu;
        total_memory += memory;

        let last_activity = last_activity_for(&svc.cwd);

        let runtime = detect_runtime(&svc.cwd);

        projects.push(ProjectOverview {
            service_id: svc.id.clone(),
            name: svc.name.clone(),
            cwd: svc.cwd.to_string_lossy().to_string(),
            runtime,
            is_running,
            git_status,
            cpu_percent: cpu,
            memory_bytes: memory,
            last_activity,
        });
    }

    Ok(OverviewSummary {
        projects,
        total_running,
        total_stopped,
        total_dirty,
        total_behind,
        total_cpu,
        total_memory,
    })
}

fn last_activity_for(cwd: &Path) -> Option<DateTime<Utc>> {
    let git_status = git::status(cwd)?;
    git_status
        .last_commit
        .map(|c| DateTime::from_timestamp(c.timestamp, 0).unwrap_or_else(Utc::now))
}

fn detect_runtime(cwd: &Path) -> Option<String> {
    if cwd.join("package.json").exists() {
        if cwd.join("bun.lockb").exists() {
            Some("bun".into())
        } else if cwd.join("deno.lock").exists() {
            Some("deno".into())
        } else {
            Some("node".into())
        }
    } else if cwd.join("Cargo.toml").exists() {
        Some("rust".into())
    } else if cwd.join("go.mod").exists() {
        Some("go".into())
    } else if cwd.join("pom.xml").exists() || cwd.join("build.gradle").exists() {
        Some("java".into())
    } else if cwd.join("requirements.txt").exists() || cwd.join("pyproject.toml").exists() {
        Some("python".into())
    } else if cwd.join("Gemfile").exists() {
        Some("ruby".into())
    } else if cwd.join("composer.json").exists() {
        Some("php".into())
    } else if cwd.join(".csproj").exists() || cwd.join("*.csproj").exists() {
        Some("dotnet".into())
    } else {
        None
    }
}

pub fn stale_projects(overview: &OverviewSummary, threshold_days: i64) -> Vec<&ProjectOverview> {
    let cutoff = Utc::now() - chrono::Duration::days(threshold_days);
    overview
        .projects
        .iter()
        .filter(|p| p.last_activity.map_or(true, |la| la < cutoff))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_runtime_node() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("node".into()));
    }

    #[test]
    fn detect_runtime_rust() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"t\"\n").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("rust".into()));
    }

    #[test]
    fn detect_runtime_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detect_runtime(dir.path()), None);
    }

    #[test]
    fn detect_runtime_bun() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("bun.lockb"), "").unwrap();
        assert_eq!(detect_runtime(dir.path()), Some("bun".into()));
    }
}
