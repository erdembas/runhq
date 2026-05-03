use std::path::Path;
use std::time::Duration;

use tokio::time::timeout;

use crate::license::{self, LicenseScanSummary};

use self::audit::{check_cargo_audit, check_npm_audit, check_pip_audit};
use self::outdated::{check_cargo_outdated, check_go_outdated, check_npm_outdated};

mod audit;
mod outdated;
mod runner;

#[cfg(test)]
pub(super) use self::audit::parse_npm_audit;
#[cfg(test)]
pub(super) use self::outdated::{parse_npm_outdated, semver_diff, SemverBump};

/// Hard cap per external command. Exceeding this kills the child and
/// returns `None` — we'd rather miss a number than hang the UI.
pub(super) const OUTDATED_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const AUDIT_TIMEOUT: Duration = Duration::from_secs(25);
/// Hard cap for the license scan side-channel. License scans walk
/// `node_modules` directly (3000+ package.json reads on a typical
/// React app) and `cargo metadata` resolves the full dep graph; both
/// can exceed the audit budget on a cold filesystem cache, so we
/// give them a slightly bigger envelope. Worst case we drop the
/// license result for one slow project — the UI degrades to "scan
/// inconclusive" rather than freezing.
const LICENSE_TIMEOUT: Duration = Duration::from_secs(35);

use super::types::{AuditResult, OutdatedResult};

pub(super) async fn run_outdated(cwd: &Path, runtime: Option<&str>) -> Option<OutdatedResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_outdated(cwd).await,
        "rust" => check_cargo_outdated(cwd).await,
        "go" => check_go_outdated(cwd).await,
        _ => None,
    }
}

pub(super) async fn run_audit(cwd: &Path, runtime: Option<&str>) -> Option<AuditResult> {
    match runtime? {
        "node" | "bun" | "deno" => check_npm_audit(cwd).await,
        "rust" => check_cargo_audit(cwd).await,
        "python" => check_pip_audit(cwd).await,
        _ => None,
    }
}

/// Collect the slim workspace-grade license summary for `cwd`.
///
/// Wraps [`license::scan_licenses`] in a hard timeout so a slow
/// project (cold filesystem cache, 5000+ packages) can't push the
/// whole `gather_dependency_scan` past the user's patience window.
/// The license module itself runs the directory walk on a blocking
/// thread, so the timeout here is just defence-in-depth — if it
/// fires, we return `None` and the UI shows "License: unknown" for
/// that card rather than blocking the rest of the batch.
pub(super) async fn run_license(cwd: &Path) -> Option<LicenseScanSummary> {
    match timeout(LICENSE_TIMEOUT, license::scan_licenses(cwd)).await {
        Ok(Ok(result)) => Some(license::summarize(&result)),
        Ok(Err(err)) => {
            tracing::warn!(?cwd, error = %err, "license scan failed");
            None
        }
        Err(_) => {
            tracing::warn!(?cwd, deadline = ?LICENSE_TIMEOUT, "license scan timed out");
            None
        }
    }
}
