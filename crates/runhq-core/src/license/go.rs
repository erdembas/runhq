use std::path::Path;

use super::runner::run_timed;
use super::types::{LicenseEntry, LicenseRisk};

pub(super) async fn scan_go_licenses(cwd: &Path) -> Vec<LicenseEntry> {
    let output = run_timed("go", &["list", "-m", "-json", "all"], cwd).await;
    let data = match output {
        Some(d) => d,
        None => return Vec::new(),
    };
    let s = String::from_utf8_lossy(&data);
    let mut entries = Vec::new();
    let stream = serde_json::Deserializer::from_str(&s).into_iter::<serde_json::Value>();
    for val in stream.flatten() {
        let name = val
            .get("Path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let version = val
            .get("Version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let license_str = "UNKNOWN".to_string();
        let risk = LicenseRisk::Unknown;
        entries.push(LicenseEntry {
            name,
            version,
            license: license_str,
            risk,
            homepage: None,
            repository: None,
        });
    }
    entries
}
