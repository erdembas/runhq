use std::path::Path;

use super::super::types::{Advisory, AuditResult};
use super::runner::run_timed;
use super::AUDIT_TIMEOUT;

impl AuditResult {
    fn from_advisories(mut advisories: Vec<Advisory>) -> Self {
        let mut result = AuditResult::default();
        for a in &advisories {
            match a.severity.as_str() {
                "critical" => result.critical += 1,
                "high" => result.high += 1,
                "medium" => result.medium += 1,
                "low" => result.low += 1,
                "info" => result.info += 1,
                _ => {}
            }
        }
        advisories.sort_by(|a, b| {
            severity_rank(&a.severity)
                .cmp(&severity_rank(&b.severity))
                .then_with(|| a.package.cmp(&b.package))
        });
        result.advisories = advisories;
        result
    }
}

/// Normalise severity strings across tools: `moderate` (npm) and `medium`
/// (cargo/pip) collapse to the same bucket.
fn normalize_severity(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().as_str() {
        "critical" => "critical",
        "high" => "high",
        "moderate" | "medium" => "medium",
        "low" => "low",
        "info" | "informational" => "info",
        _ => "low",
    }
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

// ---- Audit checkers -------------------------------------------------------

pub(super) async fn check_npm_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("npm", &["audit", "--json"], cwd, AUDIT_TIMEOUT).await?;
    parse_npm_audit(&output)
}

pub(crate) fn parse_npm_audit(stdout: &[u8]) -> Option<AuditResult> {
    let s = String::from_utf8_lossy(stdout);
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let mut advisories: Vec<Advisory> = Vec::new();

    // npm v7+ format: a `vulnerabilities` map keyed by package name, with
    // each entry carrying a `via` array where the entries are either
    // nested advisory objects or strings pointing to another offending
    // package. We only keep the object variants — string `via`s are
    // transitive and their content is already represented by the referenced
    // entry.
    if let Some(vulns) = val.get("vulnerabilities").and_then(|v| v.as_object()) {
        for (pkg_name, entry) in vulns {
            let fix_version = entry.get("fixAvailable").and_then(|f| match f {
                serde_json::Value::Object(o) => o
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                _ => None,
            });
            let range = entry
                .get("range")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if let Some(via) = entry.get("via").and_then(|v| v.as_array()) {
                for v in via {
                    let Some(obj) = v.as_object() else { continue };
                    let severity = normalize_severity(
                        obj.get("severity").and_then(|s| s.as_str()).unwrap_or(""),
                    )
                    .to_string();
                    let title = obj
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Vulnerability")
                        .to_string();
                    let id = obj
                        .get("url")
                        .and_then(|u| u.as_str())
                        .and_then(|u| u.rsplit('/').next())
                        .map(str::to_string);
                    let url = obj.get("url").and_then(|v| v.as_str()).map(str::to_string);
                    advisories.push(Advisory {
                        id,
                        package: pkg_name.clone(),
                        severity,
                        title,
                        url,
                        vulnerable_range: range.clone(),
                        fix_version: fix_version.clone(),
                    });
                }
            }
        }
        if !advisories.is_empty() {
            return Some(AuditResult::from_advisories(advisories));
        }
    }

    // npm v6 format: a flat map of advisory objects keyed by numeric id.
    if let Some(obj) = val.get("advisories").and_then(|v| v.as_object()) {
        for (key, adv) in obj {
            let severity =
                normalize_severity(adv.get("severity").and_then(|v| v.as_str()).unwrap_or(""))
                    .to_string();
            let package = adv
                .get("module_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = adv
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Vulnerability")
                .to_string();
            let url = adv.get("url").and_then(|v| v.as_str()).map(str::to_string);
            let range = adv
                .get("vulnerable_versions")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let fix_version = adv
                .get("patched_versions")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            advisories.push(Advisory {
                id: Some(key.clone()),
                package,
                severity,
                title,
                url,
                vulnerable_range: range,
                fix_version,
            });
        }
        return Some(AuditResult::from_advisories(advisories));
    }

    // No advisories section at all but the file is valid JSON: fall back
    // to metadata counts so we at least render the rolled-up summary.
    // Caller treats an empty advisories list plus non-zero counts as
    // "counts without detail" and shows a hint instead of a table.
    if let Some(m) = val
        .get("metadata")
        .and_then(|m| m.get("vulnerabilities"))
        .and_then(|v| v.as_object())
    {
        let count = |key: &str| m.get(key).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        return Some(AuditResult {
            critical: count("critical"),
            high: count("high"),
            // npm audit uses "moderate" where our schema uses "medium" —
            // single source of truth for that rename sits here.
            medium: count("moderate"),
            low: count("low"),
            info: count("info"),
            ..AuditResult::default()
        });
    }

    Some(AuditResult::default())
}

pub(super) async fn check_cargo_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("cargo", &["audit", "--json"], cwd, AUDIT_TIMEOUT).await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let list = val
        .get("vulnerabilities")
        .and_then(|v| v.get("list"))
        .and_then(|v| v.as_array())?;
    let mut advisories = Vec::with_capacity(list.len());
    for vuln in list {
        let adv = vuln.get("advisory");
        let id = adv
            .and_then(|a| a.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let package = adv
            .and_then(|a| a.get("package"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = adv
            .and_then(|a| a.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("Advisory")
            .to_string();
        let url = adv
            .and_then(|a| a.get("url"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| {
                id.as_ref()
                    .map(|i| format!("https://rustsec.org/advisories/{i}"))
            });
        // `cargo audit` does not always set a severity; fall back to "low"
        // so the count still surfaces rather than silently dropping.
        let severity_raw = adv
            .and_then(|a| a.get("severity"))
            .and_then(|v| v.as_str())
            .unwrap_or("low");
        let severity = normalize_severity(severity_raw).to_string();
        let fix_version = vuln
            .get("versions")
            .and_then(|v| v.get("patched"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let vulnerable_range = vuln
            .get("affected")
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(str::to_string);
        advisories.push(Advisory {
            id,
            package,
            severity,
            title,
            url,
            vulnerable_range,
            fix_version,
        });
    }
    Some(AuditResult::from_advisories(advisories))
}

pub(super) async fn check_pip_audit(cwd: &Path) -> Option<AuditResult> {
    let output = run_timed("pip-audit", &["--format", "json"], cwd, AUDIT_TIMEOUT).await?;
    let s = String::from_utf8_lossy(&output);
    let val: serde_json::Value = serde_json::from_str(&s).ok()?;
    let deps = val.as_array()?;
    let mut advisories: Vec<Advisory> = Vec::new();
    for dep in deps {
        let package = dep
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let current = dep
            .get("version")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let Some(vulns) = dep.get("vulns").and_then(|v| v.as_array()) else {
            continue;
        };
        for vuln in vulns {
            let id = vuln.get("id").and_then(|v| v.as_str()).map(str::to_string);
            let severity = normalize_severity(
                vuln.get("severity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("low"),
            )
            .to_string();
            let title = vuln
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.lines().next().unwrap_or(s).to_string())
                .unwrap_or_else(|| "Vulnerability".to_string());
            let url = id.as_ref().map(|i| {
                if i.starts_with("CVE-") {
                    format!("https://nvd.nist.gov/vuln/detail/{i}")
                } else if i.starts_with("GHSA-") {
                    format!("https://github.com/advisories/{i}")
                } else {
                    format!("https://osv.dev/vulnerability/{i}")
                }
            });
            let fix_version = vuln
                .get("fix_versions")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
                .map(str::to_string);
            advisories.push(Advisory {
                id,
                package: package.clone(),
                severity,
                title,
                url,
                vulnerable_range: current.clone(),
                fix_version,
            });
        }
    }
    Some(AuditResult::from_advisories(advisories))
}
