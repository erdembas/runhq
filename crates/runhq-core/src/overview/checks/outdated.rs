use std::path::Path;

use super::super::types::{OutdatedPackage, OutdatedResult};
use super::runner::run_timed;
use super::OUTDATED_TIMEOUT;

// ---- Outdated checkers ----------------------------------------------------

pub(super) async fn check_npm_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed("npm", &["outdated", "--json"], cwd, OUTDATED_TIMEOUT).await?;
    parse_npm_outdated(&output)
}

pub(crate) fn parse_npm_outdated(stdout: &[u8]) -> Option<OutdatedResult> {
    let s = String::from_utf8_lossy(stdout);
    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Some(OutdatedResult::default());
    }
    let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = val.as_object()?;
    let mut packages: Vec<OutdatedPackage> = Vec::with_capacity(obj.len());
    for (name, info) in obj {
        let Some(info_obj) = info.as_object() else {
            continue;
        };
        let current = info_obj
            .get("current")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = info_obj
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let homepage = info_obj
            .get("homepage")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| Some(format!("https://www.npmjs.com/package/{name}")));
        packages.push(OutdatedPackage {
            name: name.clone(),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            current,
            latest,
            homepage,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}

#[derive(Debug, PartialEq)]
pub(crate) enum SemverBump {
    Major,
    Minor,
    Patch,
}

impl SemverBump {
    fn as_str(&self) -> &'static str {
        match self {
            SemverBump::Major => "major",
            SemverBump::Minor => "minor",
            SemverBump::Patch => "patch",
        }
    }
}

impl OutdatedResult {
    /// Build a result from a flat package list. Handles counting and the
    /// canonical sort order (major → minor → patch → other, alpha within)
    /// so every parser emits a stable shape.
    fn from_packages(mut packages: Vec<OutdatedPackage>) -> Self {
        let mut major = 0usize;
        let mut minor = 0usize;
        let mut patch = 0usize;
        for p in &packages {
            match p.bump.as_deref() {
                Some("major") => major += 1,
                Some("minor") => minor += 1,
                Some("patch") => patch += 1,
                _ => {}
            }
        }
        packages.sort_by(|a, b| {
            fn rank(b: &Option<String>) -> u8 {
                match b.as_deref() {
                    Some("major") => 0,
                    Some("minor") => 1,
                    Some("patch") => 2,
                    _ => 3,
                }
            }
            rank(&a.bump)
                .cmp(&rank(&b.bump))
                .then_with(|| a.name.cmp(&b.name))
        });
        OutdatedResult {
            total: packages.len(),
            major,
            minor,
            patch,
            packages,
        }
    }
}

/// Classify the delta between `current` and `latest` as major/minor/patch.
///
/// Only positive (forward) deltas count; returns `None` when the versions
/// are equal, malformed, or `latest <= current` (local checkout is newer
/// than the registry — a rare but valid situation during development).
pub(crate) fn semver_diff(current: &str, latest: &str) -> Option<SemverBump> {
    fn parse(v: &str) -> Option<(u64, u64, u64)> {
        // Strip a leading `v` or semver pre-release/build suffix so the
        // comparison is on the core triplet.
        let core = v.trim_start_matches('v');
        let core = core.split(['-', '+']).next().unwrap_or(core);
        let parts: Vec<u64> = core.split('.').filter_map(|s| s.parse().ok()).collect();
        match parts.as_slice() {
            [a] => Some((*a, 0, 0)),
            [a, b] => Some((*a, *b, 0)),
            [a, b, c, ..] => Some((*a, *b, *c)),
            _ => None,
        }
    }

    let (c_maj, c_min, c_pat) = parse(current)?;
    let (l_maj, l_min, l_pat) = parse(latest)?;

    if l_maj > c_maj {
        Some(SemverBump::Major)
    } else if l_maj == c_maj && l_min > c_min {
        Some(SemverBump::Minor)
    } else if l_maj == c_maj && l_min == c_min && l_pat > c_pat {
        Some(SemverBump::Patch)
    } else {
        None
    }
}

pub(super) async fn check_cargo_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "cargo",
        &["outdated", "--format", "json"],
        cwd,
        OUTDATED_TIMEOUT,
    )
    .await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let pkgs = val.get("dependencies").and_then(|v| v.as_array())?;
    let mut packages = Vec::with_capacity(pkgs.len());
    for pkg in pkgs {
        let name = pkg
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = pkg
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = pkg
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if latest.is_empty() || latest == current || name.is_empty() {
            continue;
        }
        packages.push(OutdatedPackage {
            homepage: Some(format!("https://crates.io/crates/{name}")),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            name,
            current,
            latest,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}

pub(super) async fn check_go_outdated(cwd: &Path) -> Option<OutdatedResult> {
    let output = run_timed(
        "go",
        &["list", "-u", "-m", "-json", "all"],
        cwd,
        OUTDATED_TIMEOUT,
    )
    .await?;
    let s = String::from_utf8_lossy(&output);
    let mut packages: Vec<OutdatedPackage> = Vec::new();
    // `go list -json` emits a stream of concatenated objects; walk it with
    // a streaming deserialiser rather than per-line `from_str`, which
    // misparses when an object spans multiple lines.
    let stream = serde_json::Deserializer::from_str(&s).into_iter::<serde_json::Value>();
    for val in stream.flatten() {
        let Some(update) = val.get("Update") else {
            continue;
        };
        let name = val
            .get("Path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = val
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest = update
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        packages.push(OutdatedPackage {
            homepage: Some(format!("https://pkg.go.dev/{name}")),
            bump: semver_diff(&current, &latest).map(|b| b.as_str().to_string()),
            name,
            current,
            latest,
        });
    }
    Some(OutdatedResult::from_packages(packages))
}
