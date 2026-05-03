use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;

use super::cache::ScanCache;
use super::checks::{parse_npm_audit, parse_npm_outdated, semver_diff, SemverBump};
use super::runtime::detect_runtime;

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
    let result = parse_npm_outdated(b"{}").unwrap();
    assert_eq!(result.total, 0);
    assert!(result.packages.is_empty());
}

#[test]
fn parse_npm_outdated_mixed_bumps() {
    let json = br#"{
        "lodash":  {"current": "1.0.0", "latest": "2.0.0"},
        "react":   {"current": "18.0.0", "latest": "18.1.0"},
        "express": {"current": "4.18.1", "latest": "4.18.2"}
    }"#;
    let result = parse_npm_outdated(json).unwrap();
    assert_eq!(result.total, 3);
    assert_eq!(result.major, 1);
    assert_eq!(result.minor, 1);
    assert_eq!(result.patch, 1);
    // Sorted major → minor → patch so the UI can render in that order
    // without a second pass.
    assert_eq!(result.packages[0].name, "lodash");
    assert_eq!(result.packages[0].bump.as_deref(), Some("major"));
    assert_eq!(result.packages[0].current, "1.0.0");
    assert_eq!(result.packages[0].latest, "2.0.0");
    assert_eq!(result.packages[1].name, "react");
    assert_eq!(result.packages[2].name, "express");
    // Homepage defaults to the npmjs page when `homepage` is absent.
    assert!(result.packages[0]
        .homepage
        .as_deref()
        .unwrap()
        .starts_with("https://www.npmjs.com/package/"));
}

#[test]
fn parse_npm_audit_v7_via_advisories() {
    let json = br#"{
        "vulnerabilities": {
            "lodash": {
                "name": "lodash",
                "severity": "high",
                "range": "<4.17.21",
                "via": [
                    {
                        "source": 1094083,
                        "name": "lodash",
                        "title": "Prototype Pollution in lodash",
                        "url": "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
                        "severity": "high",
                        "range": "<4.17.21"
                    }
                ],
                "fixAvailable": {
                    "name": "lodash",
                    "version": "4.17.21",
                    "isSemVerMajor": false
                }
            }
        }
    }"#;
    let result = parse_npm_audit(json).unwrap();
    assert_eq!(result.high, 1);
    assert_eq!(result.advisories.len(), 1);
    let a = &result.advisories[0];
    assert_eq!(a.package, "lodash");
    assert_eq!(a.severity, "high");
    assert_eq!(a.id.as_deref(), Some("GHSA-35jh-r3h4-6jhm"));
    assert_eq!(a.fix_version.as_deref(), Some("4.17.21"));
    assert_eq!(a.vulnerable_range.as_deref(), Some("<4.17.21"));
}

#[test]
fn parse_npm_audit_metadata_fallback_without_advisories() {
    // Legacy or aggregated output: only metadata counts present.
    let json = br#"{
        "metadata": {
            "vulnerabilities": {
                "critical": 1, "high": 2, "moderate": 3, "low": 0, "info": 0
            }
        }
    }"#;
    let result = parse_npm_audit(json).unwrap();
    assert_eq!(result.critical, 1);
    assert_eq!(result.high, 2);
    assert_eq!(result.medium, 3);
    assert!(result.advisories.is_empty());
}

#[test]
fn semver_diff_major() {
    assert_eq!(semver_diff("1.2.3", "2.0.0"), Some(SemverBump::Major));
}

#[test]
fn semver_diff_minor() {
    assert_eq!(semver_diff("1.2.3", "1.3.0"), Some(SemverBump::Minor));
}

#[test]
fn semver_diff_patch() {
    assert_eq!(semver_diff("1.2.3", "1.2.4"), Some(SemverBump::Patch));
}

#[test]
fn semver_diff_equal_is_none() {
    assert_eq!(semver_diff("1.2.3", "1.2.3"), None);
}

#[test]
fn semver_diff_backwards_is_none() {
    // Registry shows an older "latest" than what's currently
    // installed — could happen with pinned pre-release or local
    // tarball installs; we treat it as "no update" rather than
    // misclassifying.
    assert_eq!(semver_diff("2.0.0", "1.9.9"), None);
}

#[test]
fn semver_diff_handles_v_prefix_and_prerelease() {
    assert_eq!(semver_diff("v1.0.0", "v1.0.1"), Some(SemverBump::Patch));
    assert_eq!(
        semver_diff("1.0.0-alpha", "1.0.0"),
        // Core versions are identical once the prerelease is stripped —
        // and by SemVer rules 1.0.0 IS newer than 1.0.0-alpha, but we
        // don't try to be that clever here. Documenting the current
        // behaviour so a future upgrade is intentional.
        None
    );
}

#[test]
fn scan_cache_ttl_returns_stale_as_miss() {
    let cache = ScanCache {
        inner: Arc::new(Mutex::new(HashMap::new())),
        ttl: Duration::from_millis(20),
    };
    let cwd = PathBuf::from("/tmp/runhq-overview-test");
    cache.insert(&cwd, None, None, None);
    assert!(cache.get_fresh(&cwd).is_some());
    std::thread::sleep(Duration::from_millis(40));
    assert!(cache.get_fresh(&cwd).is_none());
}
