use serde::{Deserialize, Serialize};

use crate::license::LicenseScanSummary;
use crate::overview::{AuditResult, OutdatedResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedScan {
    pub service_id: String,
    pub cwd: String,
    pub service_name: String,
    pub outdated: Option<OutdatedResult>,
    pub audit: Option<AuditResult>,
    pub license: Option<LicenseScanSummary>,
    pub scanned_at_ms: i64,
    pub duration_ms: Option<i64>,
    pub total_outdated: i64,
    pub total_vulnerabilities: i64,
    pub total_license_warnings: i64,
}
