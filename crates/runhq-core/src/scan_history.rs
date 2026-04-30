//! Persistent dependency-scan results.
//!
//! `gather_dependency_scan` runs `npm outdated` / `cargo audit` /
//! `pip-audit` / etc., which are expensive (5–30 s per project, sometimes
//! more if the registry is slow). The in-memory `ScanCache` in
//! `overview.rs` masks that for **5 minutes**, but as soon as the user
//! quits RunHQ the result is gone — they pay the full cost again on the
//! next launch and stare at empty audit chips until the parallel scan
//! finishes. Worse, we have no way to tell them "your last advisory list
//! is from yesterday — consider rescanning before shipping".
//!
//! This module bridges that gap: every successful per-service scan is
//! upserted into a small SQLite table keyed by `service_id` (with `cwd`
//! as a secondary lookup), so the dashboard can show the last known
//! advisory/outdated counts the moment it mounts and surface a
//! freshness chip ("Last scanned 3h ago") next to each project. Repeat
//! scans naturally **overwrite** the row — there's no scan history
//! ledger here on purpose: only the "latest" matters for the dashboard,
//! and a multi-row history would explode in size on workspaces that
//! background-scan every few minutes.
//!
//! # Why a separate DB file?
//!
//! Same reasoning as `conversations.rs`: different lifecycle (scans
//! mutate often, conversations rarely), different blast radius (a
//! corrupted scans table shouldn't take chat history with it), and a
//! future "wipe all caches" affordance should be one `unlink` away
//! rather than a careful surgical query.
//!
//! # Schema migration policy
//!
//! Same idiom as the rest of the codebase: `CREATE TABLE IF NOT
//! EXISTS` plus best-effort `ALTER TABLE ... ADD COLUMN` (SQLite has no
//! `IF NOT EXISTS` for columns, so duplicate-column errors are
//! deliberately swallowed). New columns added after first ship MUST be
//! nullable or have a default so existing rows survive the upgrade.

use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::license::LicenseScanSummary;
use crate::overview::{AuditResult, OutdatedResult};

/// One row from `dependency_scans`. Matches the shape the frontend
/// expects to merge into the dashboard's `ProjectOverview` items.
///
/// `outdated` and `audit` are independently `Option`-al because some
/// runtimes only support one tool (e.g. python only has `pip-audit`,
/// no outdated equivalent) — we want to remember the audit result
/// even when there's no outdated data to pair it with.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedScan {
    pub service_id: String,
    /// Absolute path of the service's working directory at scan time.
    /// Stored denormalised so a "find the cached scan for this folder"
    /// lookup works even after a service is removed and re-added (which
    /// would assign a fresh uuid and orphan the row by `service_id`).
    pub cwd: String,
    /// Snapshot of the service's display name at scan time. Used by the
    /// "last scanned: foo-backend" chip when the service has since been
    /// renamed or removed — without this we'd have no human-readable
    /// label for orphaned rows.
    pub service_name: String,
    pub outdated: Option<OutdatedResult>,
    pub audit: Option<AuditResult>,
    /// Slim license-scan summary captured alongside outdated/audit by
    /// the workspace-wide gather. Optional for the same reason
    /// `outdated`/`audit` are: not every runtime supports a license
    /// scanner today (Python is a no-op, Go's metadata is missing
    /// licenses), and old rows written before this column was added
    /// will surface as `None` after the additive migration.
    pub license: Option<LicenseScanSummary>,
    /// Wall-clock timestamp when this scan completed, in epoch ms. Used
    /// by the freshness chip ("3h ago") and the stale-recommendation
    /// banner. Picked over `Instant`-style monotonic clocks because we
    /// need to survive a process restart and compare against `Date.now()`
    /// on the JS side.
    pub scanned_at_ms: i64,
    /// How long the scan itself took (per-service), in ms. Optional
    /// because we historically didn't track it; new rows always have
    /// it, old rows from earlier installs may not. The UI uses this
    /// to show "took 14s last time" so the user knows what to expect
    /// before clicking Rescan.
    pub duration_ms: Option<i64>,
    /// Denormalised totals so the dashboard can compute global "stale
    /// counts" without re-parsing every JSON blob on hydration.
    pub total_outdated: i64,
    pub total_vulnerabilities: i64,
    /// Denormalised contamination count (`strong + network +
    /// proprietary`). Lets the dashboard's "License risk" filter chip
    /// and hero priority ladder resolve `total_license_warnings`
    /// without rehydrating `license_json`. Old rows from before the
    /// column was added land as 0 via the migration default.
    pub total_license_warnings: i64,
}

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

        // Additive migration for installs that wrote a row before the
        // license columns existed. SQLite has no `ADD COLUMN IF NOT
        // EXISTS`, so we rely on `pragma_table_info` to skip columns
        // that are already present. Each ALTER runs in its own call
        // because failing one (legitimately, e.g. due to a
        // half-applied prior upgrade) shouldn't abort the others.
        self.add_column_if_missing("license_json", "TEXT")?;
        self.add_column_if_missing("total_license_warnings", "INTEGER NOT NULL DEFAULT 0")?;
        Ok(())
    }

    /// Idempotent column adder. Cheaper than catching the
    /// duplicate-column SQLite error because the
    /// `pragma_table_info` lookup is one round-trip and we already
    /// hold the connection — no need to roll back a failed ALTER.
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
        // SQLite forbids parameter binding for DDL identifiers; the
        // inputs here are hard-coded constants from `init_schema`,
        // never user-supplied, so string formatting is safe.
        let sql = format!("ALTER TABLE dependency_scans ADD COLUMN {column} {decl}");
        self.conn
            .execute(&sql, [])
            .map_err(|e| AppError::Other(format!("alter add column {column}: {e}")))?;
        Ok(())
    }

    /// Upsert a scan row. Re-running the dependency scan for the same
    /// service overwrites the previous row in place — we deliberately
    /// don't keep a history of older scans because the dashboard only
    /// surfaces "latest" and a workspace with 30 services scanning every
    /// 10 minutes would balloon the table without anyone reading it.
    pub fn upsert(&self, scan: &PersistedScan) -> AppResult<()> {
        let outdated_json = match &scan.outdated {
            Some(o) => Some(
                serde_json::to_string(o)
                    .map_err(|e| AppError::Other(format!("serialise outdated: {e}")))?,
            ),
            None => None,
        };
        let audit_json = match &scan.audit {
            Some(a) => Some(
                serde_json::to_string(a)
                    .map_err(|e| AppError::Other(format!("serialise audit: {e}")))?,
            ),
            None => None,
        };
        let license_json = match &scan.license {
            Some(l) => Some(
                serde_json::to_string(l)
                    .map_err(|e| AppError::Other(format!("serialise license: {e}")))?,
            ),
            None => None,
        };

        // INSERT OR REPLACE is the simplest fit for "always keep the
        // latest", and the PK on service_id makes the conflict path
        // unambiguous. We don't need ON CONFLICT DO UPDATE here because
        // there are no triggers / FKs we want to preserve across the
        // replacement.
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

    /// Return every persisted scan, newest first. Cheap enough for the
    /// dashboard's hydration path because we expect at most one row per
    /// registered service (typical workspace: <50 rows, <200KB JSON).
    pub fn list_all(&self) -> AppResult<Vec<PersistedScan>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT service_id, cwd, service_name,
                        outdated_json, audit_json, license_json,
                        scanned_at_ms, duration_ms,
                        total_outdated, total_vulnerabilities, total_license_warnings
                 FROM dependency_scans
                 ORDER BY scanned_at_ms DESC",
            )
            .map_err(|e| AppError::Other(format!("prepare list scans: {e}")))?;

        let rows = stmt
            .query_map([], Self::row_to_scan)
            .map_err(|e| AppError::Other(format!("query scans: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            // A single corrupt row (e.g. an outdated_json the JSON
            // schema later changed under) shouldn't poison the whole
            // hydration — drop it and carry on, the user will rescan.
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
            .prepare(
                "SELECT service_id, cwd, service_name,
                        outdated_json, audit_json, license_json,
                        scanned_at_ms, duration_ms,
                        total_outdated, total_vulnerabilities, total_license_warnings
                 FROM dependency_scans
                 WHERE service_id = ?1",
            )
            .map_err(|e| AppError::Other(format!("prepare get scan: {e}")))?;

        let mut rows = stmt
            .query(params![service_id])
            .map_err(|e| AppError::Other(format!("query scan: {e}")))?;

        match rows
            .next()
            .map_err(|e| AppError::Other(format!("step scan: {e}")))?
        {
            Some(row) => {
                Ok(Some(Self::row_to_scan(row).map_err(|e| {
                    AppError::Other(format!("decode scan: {e}"))
                })?))
            }
            None => Ok(None),
        }
    }

    /// Path-based fallback for projects whose `service_id` changed
    /// (re-add) but whose folder is still the same — we'd still rather
    /// show "last scanned 2h ago" than nothing.
    pub fn get_by_cwd(&self, cwd: &str) -> AppResult<Option<PersistedScan>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT service_id, cwd, service_name,
                        outdated_json, audit_json, license_json,
                        scanned_at_ms, duration_ms,
                        total_outdated, total_vulnerabilities, total_license_warnings
                 FROM dependency_scans
                 WHERE cwd = ?1
                 ORDER BY scanned_at_ms DESC
                 LIMIT 1",
            )
            .map_err(|e| AppError::Other(format!("prepare get scan by cwd: {e}")))?;

        let mut rows = stmt
            .query(params![cwd])
            .map_err(|e| AppError::Other(format!("query scan by cwd: {e}")))?;

        match rows
            .next()
            .map_err(|e| AppError::Other(format!("step scan by cwd: {e}")))?
        {
            Some(row) => {
                Ok(Some(Self::row_to_scan(row).map_err(|e| {
                    AppError::Other(format!("decode scan: {e}"))
                })?))
            }
            None => Ok(None),
        }
    }

    /// Wipe a single project's cached scan. Used by the "Clear scan
    /// cache" affordance and by service-deletion cleanup, so a removed
    /// service doesn't linger forever as an orphaned row.
    pub fn delete_by_service(&self, service_id: &str) -> AppResult<()> {
        self.conn
            .execute(
                "DELETE FROM dependency_scans WHERE service_id = ?1",
                params![service_id],
            )
            .map_err(|e| AppError::Other(format!("delete scan: {e}")))?;
        Ok(())
    }

    /// Wipe everything — used by the "Reset all caches" affordance.
    /// Returns the number of rows that were dropped so the UI can show
    /// a confirmation toast.
    pub fn clear_all(&self) -> AppResult<usize> {
        let n = self
            .conn
            .execute("DELETE FROM dependency_scans", [])
            .map_err(|e| AppError::Other(format!("clear scans: {e}")))?;
        Ok(n)
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

        // Best-effort JSON decode: if the schema for OutdatedResult /
        // AuditResult / LicenseScanSummary changed under us between
        // writes, treat the field as None instead of failing the
        // whole row. The user pays a rescan, not an error toast.
        let outdated = outdated_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<OutdatedResult>(s).ok());
        let audit = audit_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<AuditResult>(s).ok());
        let license = license_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<LicenseScanSummary>(s).ok());

        Ok(PersistedScan {
            service_id,
            cwd,
            service_name,
            outdated,
            audit,
            license,
            scanned_at_ms,
            duration_ms,
            total_outdated,
            total_vulnerabilities,
            total_license_warnings,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overview::{Advisory, AuditResult, OutdatedPackage, OutdatedResult};
    use tempfile::TempDir;

    fn sample_outdated() -> OutdatedResult {
        OutdatedResult {
            total: 2,
            major: 1,
            minor: 1,
            patch: 0,
            packages: vec![
                OutdatedPackage {
                    name: "react".into(),
                    current: "17.0.0".into(),
                    latest: "18.0.0".into(),
                    bump: Some("major".into()),
                    homepage: None,
                },
                OutdatedPackage {
                    name: "vite".into(),
                    current: "5.0.0".into(),
                    latest: "5.1.0".into(),
                    bump: Some("minor".into()),
                    homepage: None,
                },
            ],
        }
    }

    fn sample_audit() -> AuditResult {
        AuditResult {
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            info: 0,
            advisories: vec![Advisory {
                id: Some("GHSA-xxxx".into()),
                package: "lodash".into(),
                severity: "high".into(),
                title: "Prototype pollution".into(),
                url: None,
                vulnerable_range: Some("<4.17.21".into()),
                fix_version: Some("4.17.21".into()),
            }],
        }
    }

    fn sample_scan(id: &str) -> PersistedScan {
        PersistedScan {
            service_id: id.into(),
            cwd: format!("/tmp/{id}"),
            service_name: format!("svc-{id}"),
            outdated: Some(sample_outdated()),
            audit: Some(sample_audit()),
            license: None,
            scanned_at_ms: 1_700_000_000_000,
            duration_ms: Some(12_345),
            total_outdated: 2,
            total_vulnerabilities: 1,
            total_license_warnings: 0,
        }
    }

    fn fresh_db() -> (TempDir, ScanHistoryDb) {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("scans.db");
        let db = ScanHistoryDb::open(&path).expect("open");
        (dir, db)
    }

    #[test]
    fn upsert_and_round_trip_via_get_by_service() {
        let (_dir, db) = fresh_db();
        let scan = sample_scan("a");
        db.upsert(&scan).unwrap();

        let got = db.get_by_service("a").unwrap().expect("row exists");
        assert_eq!(got, scan);
    }

    #[test]
    fn upsert_replaces_existing_row_for_same_service() {
        let (_dir, db) = fresh_db();

        let mut scan = sample_scan("a");
        db.upsert(&scan).unwrap();

        // Second scan: imagine the user fixed the lodash advisory and
        // bumped vite. Counts drop, scan timestamp moves forward. We
        // should see *the new state*, not a duplicate row, and the
        // total row count should still be 1.
        scan.scanned_at_ms = 1_700_000_999_000;
        scan.audit = Some(AuditResult {
            high: 0,
            ..sample_audit()
        });
        scan.total_vulnerabilities = 0;
        db.upsert(&scan).unwrap();

        let all = db.list_all().unwrap();
        assert_eq!(all.len(), 1, "upsert should not create a duplicate row");
        assert_eq!(all[0].scanned_at_ms, 1_700_000_999_000);
        assert_eq!(all[0].total_vulnerabilities, 0);
    }

    #[test]
    fn list_all_orders_by_scanned_at_desc() {
        let (_dir, db) = fresh_db();
        let mut older = sample_scan("a");
        older.scanned_at_ms = 1;
        let mut newer = sample_scan("b");
        newer.scanned_at_ms = 100;
        db.upsert(&older).unwrap();
        db.upsert(&newer).unwrap();

        let all = db.list_all().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].service_id, "b", "newest first");
        assert_eq!(all[1].service_id, "a");
    }

    #[test]
    fn get_by_cwd_returns_latest_match() {
        let (_dir, db) = fresh_db();
        // Two services pointed at the same folder (uncommon but legal:
        // think monorepo subpackages all rooted at /tmp/mono). We want
        // the freshest scan for that path.
        let mut a = sample_scan("a");
        a.cwd = "/tmp/mono".into();
        a.scanned_at_ms = 1;
        let mut b = sample_scan("b");
        b.cwd = "/tmp/mono".into();
        b.scanned_at_ms = 100;
        db.upsert(&a).unwrap();
        db.upsert(&b).unwrap();

        let got = db.get_by_cwd("/tmp/mono").unwrap().expect("hit");
        assert_eq!(got.service_id, "b");
    }

    #[test]
    fn delete_by_service_removes_only_that_row() {
        let (_dir, db) = fresh_db();
        db.upsert(&sample_scan("a")).unwrap();
        db.upsert(&sample_scan("b")).unwrap();

        db.delete_by_service("a").unwrap();
        assert!(db.get_by_service("a").unwrap().is_none());
        assert!(db.get_by_service("b").unwrap().is_some());
    }

    #[test]
    fn clear_all_returns_drop_count() {
        let (_dir, db) = fresh_db();
        db.upsert(&sample_scan("a")).unwrap();
        db.upsert(&sample_scan("b")).unwrap();
        db.upsert(&sample_scan("c")).unwrap();

        let dropped = db.clear_all().unwrap();
        assert_eq!(dropped, 3);
        assert!(db.list_all().unwrap().is_empty());
    }

    #[test]
    fn schema_is_idempotent_across_reopens() {
        // Re-opening the same file must not crash on duplicate-column
        // / duplicate-index errors — `add_column_if_missing` checks
        // `pragma_table_info` so the second open is a no-op even
        // though both `license_json` columns exist already.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("scans.db");
        let db1 = ScanHistoryDb::open(&path).unwrap();
        db1.upsert(&sample_scan("a")).unwrap();
        drop(db1);

        let db2 = ScanHistoryDb::open(&path).unwrap();
        assert_eq!(db2.list_all().unwrap().len(), 1);
    }

    #[test]
    fn legacy_db_without_license_columns_is_migrated_in_place() {
        // Simulate a DB written by an older RunHQ build that didn't
        // know about license columns. The migration must add them on
        // open, and existing rows must survive (license = None,
        // total_license_warnings = 0 by column default).
        use rusqlite::Connection;
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("scans.db");
        {
            let raw = Connection::open(&path).unwrap();
            raw.execute_batch(
                "CREATE TABLE dependency_scans (
                    service_id TEXT PRIMARY KEY,
                    cwd TEXT NOT NULL,
                    service_name TEXT NOT NULL,
                    outdated_json TEXT,
                    audit_json TEXT,
                    scanned_at_ms INTEGER NOT NULL,
                    duration_ms INTEGER,
                    total_outdated INTEGER NOT NULL DEFAULT 0,
                    total_vulnerabilities INTEGER NOT NULL DEFAULT 0
                );",
            )
            .unwrap();
            raw.execute(
                "INSERT INTO dependency_scans (
                    service_id, cwd, service_name,
                    scanned_at_ms, total_outdated, total_vulnerabilities
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "legacy",
                    "/tmp/legacy",
                    "old-svc",
                    1_700_000_000_000i64,
                    0i64,
                    0i64
                ],
            )
            .unwrap();
        }

        // Opening through the real constructor should add the missing
        // columns without dropping the legacy row.
        let db = ScanHistoryDb::open(&path).unwrap();
        let row = db
            .get_by_service("legacy")
            .unwrap()
            .expect("legacy row preserved");
        assert!(row.license.is_none());
        assert_eq!(row.total_license_warnings, 0);

        // And new license-bearing writes must round-trip through the
        // migrated table.
        let migrated_summary = LicenseScanSummary {
            runtime: Some("node".into()),
            scan_supported: true,
            total_entries: 5,
            permissive_count: 3,
            safe_count: 0,
            weak_copyleft_count: 0,
            strong_copyleft_count: 1,
            network_copyleft_count: 1,
            proprietary_count: 0,
            unknown_count: 0,
            has_contamination: true,
            top_warnings: vec![],
        };
        let mut updated = sample_scan("legacy");
        updated.license = Some(migrated_summary.clone());
        updated.total_license_warnings = 2;
        db.upsert(&updated).unwrap();

        let after = db.get_by_service("legacy").unwrap().unwrap();
        assert_eq!(after.license, Some(migrated_summary));
        assert_eq!(after.total_license_warnings, 2);
    }
}
