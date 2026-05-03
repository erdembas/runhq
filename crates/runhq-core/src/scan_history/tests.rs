use super::*;
use crate::license::LicenseScanSummary;
use crate::overview::{Advisory, AuditResult, OutdatedPackage, OutdatedResult};
use rusqlite::{params, Connection};
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

    let db = ScanHistoryDb::open(&path).unwrap();
    let row = db
        .get_by_service("legacy")
        .unwrap()
        .expect("legacy row preserved");
    assert!(row.license.is_none());
    assert_eq!(row.total_license_warnings, 0);

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
