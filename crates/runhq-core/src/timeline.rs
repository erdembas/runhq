//! Activity timeline tracking and persistence.
//!
//! Records developer activity across all projects — service start/stop,
//! git commits, errors — in a SQLite database. Provides daily summaries
//! and standup meeting export.

use std::path::Path;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum TimelineEventType {
    ServiceStarted,
    ServiceStopped,
    ServiceCrashed,
    GitCommit,
    GitPush,
    GitCheckout,
    LogError,
    LogWarning,
    FileChanged,
}

impl std::fmt::Display for TimelineEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceStarted => write!(f, "service_started"),
            Self::ServiceStopped => write!(f, "service_stopped"),
            Self::ServiceCrashed => write!(f, "service_crashed"),
            Self::GitCommit => write!(f, "git_commit"),
            Self::GitPush => write!(f, "git_push"),
            Self::GitCheckout => write!(f, "git_checkout"),
            Self::LogError => write!(f, "log_error"),
            Self::LogWarning => write!(f, "log_warning"),
            Self::FileChanged => write!(f, "file_changed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TimelineEvent {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub service_id: Option<String>,
    pub service_name: Option<String>,
    pub event_type: TimelineEventType,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DailySummary {
    pub date: String,
    pub projects_worked: usize,
    pub commits: usize,
    pub services_started: usize,
    pub errors: usize,
    pub project_names: Vec<String>,
}

pub struct TimelineDb {
    conn: Connection,
}

impl TimelineDb {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)
            .map_err(|e| AppError::Other(format!("opening timeline db: {e}")))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> AppResult<()> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS timeline_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp_ms INTEGER NOT NULL,
                    service_id TEXT,
                    service_name TEXT,
                    event_type TEXT NOT NULL,
                    description TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline_events(timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_timeline_type ON timeline_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_timeline_service ON timeline_events(service_id);",
            )
            .map_err(|e| AppError::Other(format!("init timeline schema: {e}")))?;
        Ok(())
    }

    pub fn record(
        &self,
        event_type: TimelineEventType,
        service_id: Option<&str>,
        service_name: Option<&str>,
        description: &str,
    ) -> AppResult<()> {
        let ts = Utc::now().timestamp_millis();
        self.conn
            .execute(
                "INSERT INTO timeline_events (timestamp_ms, service_id, service_name, event_type, description) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![ts, service_id, service_name, event_type.to_string(), description],
            )
            .map_err(|e| AppError::Other(format!("record timeline event: {e}")))?;
        Ok(())
    }

    pub fn get_timeline(
        &self,
        service_id: Option<&str>,
        event_type: Option<TimelineEventType>,
        since_ms: Option<i64>,
        limit: usize,
    ) -> AppResult<Vec<TimelineEvent>> {
        let mut conditions = Vec::new();
        if let Some(sid) = service_id {
            conditions.push(format!("service_id = '{}'", sid.replace('\'', "''")));
        }
        if let Some(et) = event_type {
            conditions.push(format!(
                "event_type = '{}'",
                et.to_string().replace('\'', "''")
            ));
        }
        if let Some(since) = since_ms {
            conditions.push(format!("timestamp_ms >= {since}"));
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!(" AND {}", conditions.join(" AND "))
        };
        let sql = format!(
            "SELECT id, timestamp_ms, service_id, service_name, event_type, description FROM timeline_events WHERE 1=1{} ORDER BY timestamp_ms DESC LIMIT ?1",
            where_clause
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AppError::Other(format!("prepare timeline query: {e}")))?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                let ts_ms: i64 = row.get(1)?;
                let timestamp = DateTime::from_timestamp_millis(ts_ms).unwrap_or_else(Utc::now);
                let et_str: String = row.get(4)?;
                let event_type = match et_str.as_str() {
                    "service_started" => TimelineEventType::ServiceStarted,
                    "service_stopped" => TimelineEventType::ServiceStopped,
                    "service_crashed" => TimelineEventType::ServiceCrashed,
                    "git_commit" => TimelineEventType::GitCommit,
                    "git_push" => TimelineEventType::GitPush,
                    "git_checkout" => TimelineEventType::GitCheckout,
                    "log_error" => TimelineEventType::LogError,
                    "log_warning" => TimelineEventType::LogWarning,
                    "file_changed" => TimelineEventType::FileChanged,
                    _ => TimelineEventType::LogError,
                };
                Ok(TimelineEvent {
                    id: row.get(0)?,
                    timestamp,
                    service_id: row.get(2)?,
                    service_name: row.get(3)?,
                    event_type,
                    description: row.get(5)?,
                })
            })
            .map_err(|e| AppError::Other(format!("query timeline: {e}")))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_daily_summary(&self, date: NaiveDate) -> AppResult<DailySummary> {
        let day_start = date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let day_end = date
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_utc()
            .timestamp_millis();

        let events = self.get_timeline(None, None, Some(day_start), 10000)?;

        let day_events: Vec<_> = events
            .iter()
            .filter(|e| e.timestamp.timestamp_millis() <= day_end)
            .collect();

        let mut project_names = std::collections::HashSet::new();
        let mut commits = 0usize;
        let mut services_started = 0usize;
        let mut errors = 0usize;

        for e in &day_events {
            if let Some(name) = &e.service_name {
                project_names.insert(name.clone());
            }
            match e.event_type {
                TimelineEventType::GitCommit => commits += 1,
                TimelineEventType::ServiceStarted => services_started += 1,
                TimelineEventType::LogError | TimelineEventType::ServiceCrashed => errors += 1,
                _ => {}
            }
        }

        Ok(DailySummary {
            date: date.to_string(),
            projects_worked: project_names.len(),
            commits,
            services_started,
            errors,
            project_names: project_names.into_iter().collect(),
        })
    }

    pub fn get_weekly_summary(&self, end_date: NaiveDate) -> AppResult<Vec<DailySummary>> {
        let mut summaries = Vec::new();
        for i in 0..7 {
            let date = end_date - chrono::Duration::days(i);
            let summary = self.get_daily_summary(date)?;
            summaries.push(summary);
        }
        Ok(summaries)
    }

    pub fn export_standup(&self, since_ms: i64) -> AppResult<String> {
        let events = self.get_timeline(None, None, Some(since_ms), 1000)?;
        let mut out = String::new();
        out.push_str("## Yesterday's Activity\n\n");

        let mut by_project: std::collections::BTreeMap<String, Vec<&TimelineEvent>> =
            std::collections::BTreeMap::new();
        for e in &events {
            let key = e
                .service_name
                .clone()
                .unwrap_or_else(|| "Other".to_string());
            by_project.entry(key).or_default().push(e);
        }

        for (project, evts) in &by_project {
            out.push_str(&format!("### {project}\n"));
            for e in evts {
                let time = e.timestamp.format("%H:%M");
                out.push_str(&format!("- [{time}] {}: {}\n", e.event_type, e.description));
            }
            out.push('\n');
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_and_query() {
        let dir = tempfile::tempdir().unwrap();
        let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
        db.record(
            TimelineEventType::ServiceStarted,
            Some("svc1"),
            Some("frontend"),
            "Started dev server",
        )
        .unwrap();
        db.record(
            TimelineEventType::GitCommit,
            Some("svc1"),
            Some("frontend"),
            "fix: login button",
        )
        .unwrap();
        db.record(
            TimelineEventType::ServiceStopped,
            Some("svc1"),
            Some("frontend"),
            "Stopped dev server",
        )
        .unwrap();
        let events = db.get_timeline(None, None, None, 100).unwrap();
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn filter_by_type() {
        let dir = tempfile::tempdir().unwrap();
        let db = TimelineDb::open(&dir.path().join("timeline.db")).unwrap();
        db.record(TimelineEventType::ServiceStarted, None, None, "start")
            .unwrap();
        db.record(TimelineEventType::GitCommit, None, None, "commit")
            .unwrap();
        let events = db
            .get_timeline(None, Some(TimelineEventType::GitCommit), None, 100)
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, TimelineEventType::GitCommit);
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
        )
        .unwrap();
        db.record(
            TimelineEventType::GitCommit,
            Some("s1"),
            Some("api"),
            "fix: endpoint",
        )
        .unwrap();
        db.record(
            TimelineEventType::LogError,
            Some("s1"),
            Some("api"),
            "ECONNREFUSED",
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
        )
        .unwrap();
        let since = Utc::now().timestamp_millis() - 86_400_000;
        let export = db.export_standup(since).unwrap();
        assert!(export.contains("frontend"));
        assert!(export.contains("feat: new page"));
    }
}
