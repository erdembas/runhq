use super::*;
use chrono::Utc;

#[test]
fn record_and_query() {
    let dir = tempfile::tempdir().unwrap();
    let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
    db.record(
        TimelineEventType::ServiceStarted,
        Some("svc1"),
        Some("frontend"),
        "Started dev server",
        None,
    )
    .unwrap();
    db.record(
        TimelineEventType::GitCommit,
        Some("svc1"),
        Some("frontend"),
        "fix: login button",
        None,
    )
    .unwrap();
    db.record(
        TimelineEventType::ServiceStopped,
        Some("svc1"),
        Some("frontend"),
        "Stopped dev server",
        None,
    )
    .unwrap();
    let events = db.get_timeline(None, None, None, 100).unwrap();
    assert_eq!(events.len(), 3);
}

#[test]
fn filter_by_type() {
    let dir = tempfile::tempdir().unwrap();
    let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
    db.record(TimelineEventType::ServiceStarted, None, None, "start", None)
        .unwrap();
    db.record(TimelineEventType::GitCommit, None, None, "commit", None)
        .unwrap();
    let events = db
        .get_timeline(None, Some(TimelineEventType::GitCommit), None, 100)
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, TimelineEventType::GitCommit);
}

#[test]
fn run_id_is_persisted_and_retrievable() {
    let dir = tempfile::tempdir().unwrap();
    let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
    let run = "run-abc-123";
    db.record(
        TimelineEventType::ServiceStarted,
        Some("svc1"),
        Some("api"),
        "Started",
        Some(run),
    )
    .unwrap();
    db.record(
        TimelineEventType::LogError,
        Some("svc1"),
        Some("api"),
        "boom",
        Some(run),
    )
    .unwrap();
    db.record(
        TimelineEventType::GitCommit,
        Some("svc1"),
        Some("api"),
        "feat: x",
        None,
    )
    .unwrap();
    let events = db.get_timeline(None, None, None, 100).unwrap();
    let with_run: Vec<_> = events
        .iter()
        .filter(|e| e.run_id.as_deref() == Some(run))
        .collect();
    assert_eq!(with_run.len(), 2);
    let without = events.iter().filter(|e| e.run_id.is_none()).count();
    assert_eq!(without, 1);
}

#[test]
fn daily_summary() {
    let dir = tempfile::tempdir().unwrap();
    let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
    db.record(
        TimelineEventType::ServiceStarted,
        Some("s1"),
        Some("api"),
        "Started API",
        None,
    )
    .unwrap();
    db.record(
        TimelineEventType::GitCommit,
        Some("s1"),
        Some("api"),
        "fix: endpoint",
        None,
    )
    .unwrap();
    db.record(
        TimelineEventType::LogError,
        Some("s1"),
        Some("api"),
        "ECONNREFUSED",
        None,
    )
    .unwrap();
    let today = Utc::now().date_naive();
    let summary = db.get_daily_summary(today).unwrap();
    assert_eq!(summary.commits, 1);
    assert_eq!(summary.services_started, 1);
    assert_eq!(summary.errors, 1);
}

#[test]
fn standup_export() {
    let dir = tempfile::tempdir().unwrap();
    let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
    db.record(
        TimelineEventType::GitCommit,
        Some("s1"),
        Some("frontend"),
        "feat: new page",
        None,
    )
    .unwrap();
    let since = Utc::now().timestamp_millis() - 86_400_000;
    let export = db.export_standup(since).unwrap();
    assert!(export.contains("frontend"));
    assert!(export.contains("feat: new page"));
}
