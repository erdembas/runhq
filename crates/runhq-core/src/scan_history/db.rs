use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::license::LicenseScanSummary;
use crate::overview::{AuditResult, OutdatedResult};

use super::PersistedScan;

pub struct ScanHistoryDb {
    conn: Connection,
}

impl ScanHistoryDb {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)
            .map_err(|e| AppError::Other(format!("opening scan history db: {e}")))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> AppResult<()> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS dependency_scans (
                    service_id TEXT PRIMARY KEY,
                    cwd TEXT NOT NULL,
                    service_name TEXT NOT NULL,
                    outdated_json TEXT,
                    audit_json TEXT,
                    license_json TEXT,
                    scanned_at_ms INTEGER NOT NULL,
                    duration_ms INTEGER,
                    total_outdated INTEGER NOT NULL DEFAULT 0,
                    total_vulnerabilities INTEGER NOT NULL DEFAULT 0,
                    total_license_warnings INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_scans_scanned_at
                    ON dependency_scans (scanned_at_ms DESC);
                CREATE INDEX IF NOT EXISTS idx_scans_cwd
                    ON dependency_scans (cwd);",
            )
            .map_err(|e| AppError::Other(format!("init scan history schema: {e}")))?;

        self.add_column_if_missing("license_json", "TEXT")?;
        self.add_column_if_missing("total_license_warnings", "INTEGER NOT NULL DEFAULT 0")?;
        Ok(())
    }

    fn add_column_if_missing(&self, column: &str, decl: &str) -> AppResult<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT 1 FROM pragma_table_info('dependency_scans') WHERE name = ?1")
            .map_err(|e| AppError::Other(format!("prepare table_info: {e}")))?;
        let exists = stmt
            .exists(params![column])
            .map_err(|e| AppError::Other(format!("query table_info: {e}")))?;
        if exists {
            return Ok(());
        }
        let sql = format!("ALTER TABLE dependency_scans ADD COLUMN {column} {decl}");
        self.conn
            .execute(&sql, [])
            .map_err(|e| AppError::Other(format!("alter add column {column}: {e}")))?;
        Ok(())
    }

    pub fn upsert(&self, scan: &PersistedScan) -> AppResult<()> {
        let outdated_json = to_json_option(&scan.outdated, "outdated")?;
        let audit_json = to_json_option(&scan.audit, "audit")?;
        let license_json = to_json_option(&scan.license, "license")?;

        self.conn
            .execute(
                "INSERT OR REPLACE INTO dependency_scans (
                    service_id, cwd, service_name,
                    outdated_json, audit_json, license_json,
                    scanned_at_ms, duration_ms,
                    total_outdated, total_vulnerabilities, total_license_warnings
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    scan.service_id,
                    scan.cwd,
                    scan.service_name,
                    outdated_json,
                    audit_json,
                    license_json,
                    scan.scanned_at_ms,
                    scan.duration_ms,
                    scan.total_outdated,
                    scan.total_vulnerabilities,
                    scan.total_license_warnings,
                ],
            )
            .map_err(|e| AppError::Other(format!("upsert scan: {e}")))?;
        Ok(())
    }

    pub fn list_all(&self) -> AppResult<Vec<PersistedScan>> {
        let mut stmt = self
            .conn
            .prepare(&select_scan_sql("ORDER BY scanned_at_ms DESC"))
            .map_err(|e| AppError::Other(format!("prepare list scans: {e}")))?;
        let rows = stmt
            .query_map([], row_to_scan)
            .map_err(|e| AppError::Other(format!("query scans: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            match r {
                Ok(row) => out.push(row),
                Err(e) => tracing::warn!("scan history row decode failed: {e}"),
            }
        }
        Ok(out)
    }

    pub fn get_by_service(&self, service_id: &str) -> AppResult<Option<PersistedScan>> {
        let mut stmt = self
            .conn
            .prepare(&select_scan_sql("WHERE service_id = ?1"))
            .map_err(|e| AppError::Other(format!("prepare get scan: {e}")))?;
        let mut rows = stmt
            .query(params![service_id])
            .map_err(|e| AppError::Other(format!("query scan: {e}")))?;
        next_scan(&mut rows, "scan")
    }

    pub fn get_by_cwd(&self, cwd: &str) -> AppResult<Option<PersistedScan>> {
        let mut stmt = self
            .conn
            .prepare(&select_scan_sql(
                "WHERE cwd = ?1 ORDER BY scanned_at_ms DESC LIMIT 1",
            ))
            .map_err(|e| AppError::Other(format!("prepare get scan by cwd: {e}")))?;
        let mut rows = stmt
            .query(params![cwd])
            .map_err(|e| AppError::Other(format!("query scan by cwd: {e}")))?;
        next_scan(&mut rows, "scan by cwd")
    }

    pub fn delete_by_service(&self, service_id: &str) -> AppResult<()> {
        self.conn
            .execute(
                "DELETE FROM dependency_scans WHERE service_id = ?1",
                params![service_id],
            )
            .map_err(|e| AppError::Other(format!("delete scan: {e}")))?;
        Ok(())
    }

    pub fn clear_all(&self) -> AppResult<usize> {
        let n = self
            .conn
            .execute("DELETE FROM dependency_scans", [])
            .map_err(|e| AppError::Other(format!("clear scans: {e}")))?;
        Ok(n)
    }
}

fn select_scan_sql(tail: &str) -> String {
    format!(
        "SELECT service_id, cwd, service_name,
                outdated_json, audit_json, license_json,
                scanned_at_ms, duration_ms,
                total_outdated, total_vulnerabilities, total_license_warnings
         FROM dependency_scans {tail}"
    )
}

fn to_json_option<T: serde::Serialize>(
    value: &Option<T>,
    label: &str,
) -> AppResult<Option<String>> {
    value
        .as_ref()
        .map(|v| {
            serde_json::to_string(v).map_err(|e| AppError::Other(format!("serialise {label}: {e}")))
        })
        .transpose()
}

fn next_scan(rows: &mut rusqlite::Rows<'_>, label: &str) -> AppResult<Option<PersistedScan>> {
    match rows
        .next()
        .map_err(|e| AppError::Other(format!("step {label}: {e}")))?
    {
        Some(row) => {
            Ok(Some(row_to_scan(row).map_err(|e| {
                AppError::Other(format!("decode {label}: {e}"))
            })?))
        }
        None => Ok(None),
    }
}

fn row_to_scan(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedScan> {
    let service_id: String = row.get(0)?;
    let cwd: String = row.get(1)?;
    let service_name: String = row.get(2)?;
    let outdated_json: Option<String> = row.get(3)?;
    let audit_json: Option<String> = row.get(4)?;
    let license_json: Option<String> = row.get(5)?;
    let scanned_at_ms: i64 = row.get(6)?;
    let duration_ms: Option<i64> = row.get(7)?;
    let total_outdated: i64 = row.get(8)?;
    let total_vulnerabilities: i64 = row.get(9)?;
    let total_license_warnings: i64 = row.get(10)?;

    Ok(PersistedScan {
        service_id,
        cwd,
        service_name,
        outdated: outdated_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<OutdatedResult>(s).ok()),
        audit: audit_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<AuditResult>(s).ok()),
        license: license_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<LicenseScanSummary>(s).ok()),
        scanned_at_ms,
        duration_ms,
        total_outdated,
        total_vulnerabilities,
        total_license_warnings,
    })
}
