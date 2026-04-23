//! Cross-project overview and aggregation.
//!
//! Provides a bird's-eye view across all registered services —
//! git status matrix, resource heatmap, stale project detection,
//! dependency outdatedness signals, and security audit results.
//!
//! The gather is split into two phases:
//! 1. **Fast** (sync): git status, resources, stale detection — runs in spawn_blocking
//! 2. **Slow** (async): outdated + audit — runs in parallel per service with timeouts

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::task::JoinSet;

use crate::error::AppResult;
use crate::git::{self, GitStatus};
use crate::process::Supervisor;
use crate::resources::ResourceSample;
use crate::state::Store;

const OUTDATED_TIMEOUT: Duration = Duration::from_secs(15);
const AUDIT_TIMEOUT: Duration = Duration::from_secs(20);

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
    pub is_stale: bool,
    pub outdated: Option<OutdatedResult>,
    pub audit: Option<AuditResult>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutdatedResult {
    pub total: usize,
    pub major: usize,
    pub minor: usize,
    pub patch: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AuditResult {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
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
    pub total_outdated: usize,
    pub total_vulnerabilities: usize,
    pub stale_count: usize,
}

struct FastProject {
    service_id: String,
    name: String,
    cwd: PathBuf,
    runtime: Option<String>,
    is_running: bool,
    git_status: Option<GitStatus>,
    cpu_percent: f32,
    memory_bytes: u64,
    last_activity: Option<DateTime<Utc>>,
    is_stale: bool,
    tags: Vec<String>,
}

pub async fn gather_overview(
    store: &Store,
    supervisor: &Supervisor,
    stale_threshold_days: i64,
) -> AppResult<OverviewSummary> {
    let services = store.services();
    let cutoff = Utc::now() - chrono::Duration::days(stale_threshold_days);

    let mut fast = Vec::with_capacity(services.len());
    for svc in &services {
        let is_running = supervisor.is_running(&svc.id);
        let git_status = git::status(&svc.cwd);
        let (cpu, memory) = match supervisor.get_resources(&svc.id) {
            Some(ResourceSample {
                cpu_percent,
                memory_bytes,
            }) => (cpu_percent, memory_bytes),
            None => (0.0, 0),
        };
        let last_activity = last_activity_for(&svc.cwd);
        let is_stale = last_activity.map_or(true, |la| la < cutoff);
        let runtime = detect_runtime(&svc.cwd);
        fast.push(FastProject {
            service_id: svc.id.clone(),
            name: svc.name.clone(),
            cwd: svc.cwd.clone(),
            runtime,
            is_running,
            git_status,
            cpu_percent: cpu,
            memory_bytes: memory,
            last_activity,
            is_stale,
            tags: svc.tags.clone(),
        });
    }

    let mut join_set = JoinSet::new();
    for fp in &fast {
        let cwd = fp.cwd.clone();
        let runtime = fp.runtime.clone();
        join_set.spawn(async move {
            let o_cwd = cwd.clone();
            let outdated = tokio::task::spawn_blocking(move || {
                check_outdated_with_timeout(&o_cwd, runtime.as_deref())
            })
            .await
            .ok()
            .flatten();
            (cwd, outdated, None::<AuditResult>)
        });
        let cwd_a = fp.cwd.clone();
        let runtime_a = fp.runtime.clone();
        join_set.spawn(async move {
            let a_cwd = cwd_a.clone();
            let audit = tokio::task::spawn_blocking(move || {
                check_audit_with_timeout(&a_cwd, runtime_a.as_deref())
            })
            .await
            .ok()
            .flatten();
            (cwd_a, None::<OutdatedResult>, audit)
        });
    }

    let mut outdated_map: std::collections::HashMap<PathBuf, OutdatedResult> =
        std::collections::HashMap::new();
    let mut audit_map: std::collections::HashMap<PathBuf, AuditResult> =
        std::collections::HashMap::new();
    while let Some(res) = join_set.join_next().await {
        let Ok((cwd, outdated, audit)) = res else {
            continue;
        };
        if let Some(o) = outdated {
            outdated_map.insert(cwd.clone(), o);
        }
        if let Some(a) = audit {
            audit_map.insert(cwd.clone(), a);
        }
    }

    let mut projects = Vec::with_capacity(fast.len());
    let mut total_running = 0usize;
    let mut total_stopped = 0usize;
    let mut total_dirty = 0usize;
    let mut total_behind = 0usize;
    let mut total_cpu = 0.0f32;
    let mut total_memory = 0u64;
    let mut total_outdated = 0usize;
    let mut total_vulnerabilities = 0usize;
    let mut stale_count = 0usize;

    for fp in fast {
        if fp.is_running {
            total_running += 1;
        } else {
            total_stopped += 1;
        }
        if let Some(ref gs) = fp.git_status {
            if gs.is_dirty {
                total_dirty += 1;
            }
            if gs.behind > 0 {
                total_behind += 1;
            }
        }
        total_cpu += fp.cpu_percent;
        total_memory += fp.memory_bytes;
        if fp.is_stale {
            stale_count += 1;
        }

        let outdated = outdated_map.remove(&fp.cwd);
        if let Some(ref o) = outdated {
            total_outdated += o.total;
        }
        let audit = audit_map.remove(&fp.cwd);
        if let Some(ref a) = audit {
            total_vulnerabilities += a.critical + a.high + a.medium + a.low;
        }

        projects.push(ProjectOverview {
            service_id: fp.service_id,
            name: fp.name,
            cwd: fp.cwd.to_string_lossy().to_string(),
            runtime: fp.runtime,
            is_running: fp.is_running,
            git_status: fp.git_status,
            cpu_percent: fp.cpu_percent,
            memory_bytes: fp.memory_bytes,
            last_activity: fp.last_activity,
            is_stale: fp.is_stale,
            outdated,
            audit,
            tags: fp.tags,
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
        total_outdated,
        total_vulnerabilities,
        stale_count,
    })
}

pub fn stale_projects(overview: &OverviewSummary, threshold_days: i64) -> Vec<&ProjectOverview> {
    let cutoff = Utc::now() - chrono::Duration::days(threshold_days);
    overview
        .projects
        .iter()
        .filter(|p| p.last_activity.map_or(true, |la| la < cutoff))
        .collect()
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
    } else {
        None
    }
}

fn check_outdated_with_timeout(cwd: &Path, runtime: Option<&str>) -> Option<OutdatedResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_outdated(cwd),
        "rust" => check_cargo_outdated(cwd),
        "go" => check_go_outdated(cwd),
        _ => None,
    }
}

fn check_audit_with_timeout(cwd: &Path, runtime: Option<&str>) -> Option<AuditResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_audit(cwd),
        "rust" => check_cargo_audit(cwd),
        "python" => check_pip_audit(cwd),
        _ => None,
    }
}

fn check_npm_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed("npm", &["outdated", "--json"], cwd, OUTDATED_TIMEOUT)?;
    parse_npm_outdated(&output.stdout)
}

fn parse_npm_outdated(stdout: &[u8]) -> Option<OutdatedResult> {
    let s = String::from_utf8_lossy(stdout);
    if s.trim().is_empty() || s.trim() == "{}" {
        return Some(OutdatedResult {
            total: 0,
            major: 0,
            minor: 0,
            patch: 0,
        });
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) else {
        return None;
    };
    let Some(obj) = val.as_object() else {
        return None;
    };
    let total = obj.len();
    let mut major = 0usize;
    let mut minor = 0usize;
    let mut patch = 0usize;
    for (_name, info) in obj {
        let Some(info_obj) = info.as_object() else {
            continue;
        };
        let current = info_obj
            .get("current")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let latest = info_obj
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(diff) = semver_diff(current, latest) {
            match diff {
                SemverBump::Major => major += 1,
                SemverBump::Minor => minor += 1,
                SemverBump::Patch => patch += 1,
            }
        }
    }
    Some(OutdatedResult {
        total,
        major,
        minor,
        patch,
    })
}

enum SemverBump {
    Major,
    Minor,
    Patch,
}

fn semver_diff(current: &str, latest: &str) -> Option<SemverBump> {
    let cur: Vec<u64> = current.split('.').filter_map(|s| s.parse().ok()).collect();
    let lat: Vec<u64> = latest.split('.').filter_map(|s| s.parse().ok()).collect();
    if cur.len() < 1 || lat.len() < 1 {
        return None;
    }
    if lat[0] > cur[0] {
        Some(SemverBump::Major)
    } else if lat.len() > 1 && cur.len() > 1 && lat[1] > cur[1] {
        Some(SemverBump::Minor)
    } else if lat.len() > 2 && cur.len() > 2 && lat[2] > cur[2] {
        Some(SemverBump::Patch)
    } else {
        Some(SemverBump::Patch)
    }
}

fn check_cargo_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "cargo",
        &["outdated", "--format", "json"],
        cwd,
        OUTDATED_TIMEOUT,
    )?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) else {
        return None;
    };
    let pkgs = val.as_array()?;
    let total = pkgs.len();
    let mut major = 0usize;
    let mut minor = 0usize;
    let mut patch = 0usize;
    for pkg in pkgs {
        let status = pkg.get("status").and_then(|v| v.as_str()).unwrap_or("");
        match status {
            "Major" => major += 1,
            "Minor" => minor += 1,
            "Patch" => patch += 1,
            _ => {}
        }
    }
    Some(OutdatedResult {
        total,
        major,
        minor,
        patch,
    })
}

fn check_go_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "go",
        &["list", "-u", "-m", "-json", "all"],
        cwd,
        OUTDATED_TIMEOUT,
    )?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let mut total = 0usize;
    let mut major = 0usize;
    let mut minor = 0usize;
    let mut patch = 0usize;
    for line in s.lines() {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let update = val.get("Update");
        if update.is_some() {
            total += 1;
            let current = val.get("Version").and_then(|v| v.as_str()).unwrap_or("");
            let latest = update
                .and_then(|u| u.get("Version"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match semver_diff(current, latest) {
                Some(SemverBump::Major) => major += 1,
                Some(SemverBump::Minor) => minor += 1,
                Some(SemverBump::Patch) => patch += 1,
                None => patch += 1,
            }
        }
    }
    Some(OutdatedResult {
        total,
        major,
        minor,
        patch,
    })
}

fn check_npm_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("npm", &["audit", "--json"], cwd, AUDIT_TIMEOUT)?;
    let s = String::from_utf8_lossy(&output.stdout);
    if s.trim().is_empty() {
        return None;
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) else {
        return None;
    };
    let mut result = AuditResult {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
    };
    let metadata = val.get("metadata");
    if let Some(vulns) = metadata.and_then(|m| m.get("vulnerabilities")) {
        result.critical = vulns.get("critical").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        result.high = vulns.get("high").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        result.medium = vulns.get("moderate").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        result.low = vulns.get("low").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        result.info = vulns.get("info").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    } else if let Some(advisories) = val.as_object() {
        for (_key, adv) in advisories {
            let severity = adv.get("severity").and_then(|v| v.as_str()).unwrap_or("");
            match severity {
                "critical" => result.critical += 1,
                "high" => result.high += 1,
                "moderate" | "medium" => result.medium += 1,
                "low" => result.low += 1,
                "info" => result.info += 1,
                _ => result.low += 1,
            }
        }
    }
    Some(result)
}

fn check_cargo_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("cargo", &["audit", "--json"], cwd, AUDIT_TIMEOUT)?;
    let s = String::from_utf8_lossy(&output.stdout);
    if s.trim().is_empty() {
        return None;
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) else {
        return None;
    };
    let mut result = AuditResult {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
    };
    let vulnerabilities = val
        .get("vulnerabilities")
        .and_then(|v| v.get("list"))
        .and_then(|v| v.as_array());
    if let Some(list) = vulnerabilities {
        for vuln in list {
            let severity = vuln
                .get("advisory")
                .and_then(|a| a.get("severity"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match severity {
                "critical" => result.critical += 1,
                "high" => result.high += 1,
                "medium" => result.medium += 1,
                "low" => result.low += 1,
                "info" => result.info += 1,
                _ => result.low += 1,
            }
        }
    }
    Some(result)
}

fn check_pip_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("pip-audit", &["--format", "json"], cwd, AUDIT_TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) else {
        return None;
    };
    let deps = val.as_array()?;
    let mut result = AuditResult {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
    };
    for dep in deps {
        let Some(vulns) = dep.get("vulns").and_then(|v| v.as_array()) else {
            continue;
        };
        for vuln in vulns {
            let severity = vuln
                .get("severity")
                .and_then(|v| v.as_str())
                .unwrap_or("low");
            match severity {
                "critical" => result.critical += 1,
                "high" => result.high += 1,
                "medium" => result.medium += 1,
                "low" => result.low += 1,
                "info" => result.info += 1,
                _ => result.low += 1,
            }
        }
    }
    Some(result)
}

struct CmdOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
}

fn run_timed(program: &str, args: &[&str], cwd: &Path, _timeout: Duration) -> Option<CmdOutput> {
    let child = StdCommand::new(program)
        .args(args)
        .current_dir(cwd)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    match child.wait_with_output() {
        Ok(output) if output.status.success() || !output.stdout.is_empty() => Some(CmdOutput {
            status: output.status,
            stdout: output.stdout,
        }),
        Ok(output) => Some(CmdOutput {
            status: output.status,
            stdout: output.stdout,
        }),
        Err(_) => None,
    }
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

    #[test]
    fn parse_npm_outdated_empty() {
        let result = parse_npm_outdated(b"{}");
        assert_eq!(
            result,
            Some(OutdatedResult {
                total: 0,
                major: 0,
                minor: 0,
                patch: 0,
            })
        );
    }

    #[test]
    fn semver_diff_major() {
        assert!(matches!(
            semver_diff("1.0.0", "2.0.0"),
            Some(SemverBump::Major)
        ));
    }

    #[test]
    fn semver_diff_minor() {
        assert!(matches!(
            semver_diff("1.0.0", "1.1.0"),
            Some(SemverBump::Minor)
        ));
    }
}
