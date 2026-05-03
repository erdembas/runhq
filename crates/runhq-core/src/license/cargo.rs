use std::path::Path;

use super::classifier::classify_license;
use super::runner::run_timed;
use super::types::LicenseEntry;

pub(super) async fn scan_cargo_licenses(cwd: &Path) -> Vec<LicenseEntry> {
    // `--no-deps` would only return workspace members — i.e. the
    // user's own crates, NOT the third-party deps whose licenses
    // are the entire point of a contamination scan. We deliberately
    // ask for the full resolved graph so transitive deps land in
    // the report.
    //
    // `--locked` gates the scan on a fresh Cargo.lock — without it
    // `cargo metadata` will silently re-resolve and rewrite the
    // lockfile, which is a side-effect the user didn't ask for.
    // If the lockfile is stale we'd rather report no entries
    // (caller will surface "scan inconclusive") than mutate the
    // user's tree from a license panel.
    let output = run_timed(
        "cargo",
        &["metadata", "--format-version", "1", "--locked"],
        cwd,
    )
    .await;
    let data = match output {
        Some(d) => d,
        None => {
            // Fall back to a non-locked metadata read if the user
            // hasn't run `cargo build` yet. Without this fallback
            // an entire Rust project would scan as zero entries on
            // the very first license panel open.
            match run_timed("cargo", &["metadata", "--format-version", "1"], cwd).await {
                Some(d) => d,
                None => return Vec::new(),
            }
        }
    };
    let s = String::from_utf8_lossy(&data);
    let val: serde_json::Value = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut entries = Vec::new();
    if let Some(packages) = val.get("packages").and_then(|v| v.as_array()) {
        for pkg in packages {
            let name = pkg
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let version = pkg
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // SPDX expression first; fall back to `license_file`
            // (Cargo's escape hatch for non-SPDX or custom-text
            // licenses). When neither is present we leave the
            // string blank so `classify_license` reports
            // `Unknown` without a misleading literal "UNKNOWN".
            let license_str = pkg
                .get("license")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    pkg.get("license_file")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|_| "see-license-file".to_string())
                })
                .unwrap_or_else(|| "UNKNOWN".to_string());
            let homepage = pkg
                .get("homepage")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let repository = pkg
                .get("repository")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let risk = classify_license(&license_str);
            entries.push(LicenseEntry {
                name,
                version,
                license: license_str,
                risk,
                homepage,
                repository,
            });
        }
    }
    entries
}
