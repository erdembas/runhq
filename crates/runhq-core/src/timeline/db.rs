use std::path::Path;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};

use super::{DailySummary, TimelineEvent, TimelineEventType};

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
                    description TEXT NOT NULL,
                    run_id TEXT
                );",
            )
            .map_err(|e| AppError::Other(format!("init timeline schema: {e}")))?;

        let _ = self
            .conn
            .execute("ALTER TABLE timeline_events ADD COLUMN run_id TEXT", []);

        self.conn
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline_events(timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_timeline_type ON timeline_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_timeline_service ON timeline_events(service_id);
                CREATE INDEX IF NOT EXISTS idx_timeline_run ON timeline_events(run_id);",
            )
            .map_err(|e| AppError::Other(format!("init timeline indices: {e}")))?;
        Ok(())
    }

    pub fn record(
        &self,
        event_type: TimelineEventType,
        service_id: Option<&str>,
        service_name: Option<&str>,
        description: &str,
        run_id: Option<&str>,
    ) -> AppResult<()> {
        let ts = Utc::now().timestamp_millis();
        self.conn
            .execute(
                "INSERT INTO timeline_events (timestamp_ms, service_id, service_name, event_type, description, run_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![ts, service_id, service_name, event_type.to_string(), description, run_id],
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
        let where_clause = timeline_where_clause(service_id, event_type, since_ms);
        let sql = format!(
            "SELECT id, timestamp_ms, service_id, service_name, event_type, description, run_id FROM timeline_events WHERE 1=1{} ORDER BY timestamp_ms DESC LIMIT ?1",
            where_clause
        );
        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AppError::Other(format!("prepare timeline query: {e}")))?;
        let rows = stmt
            .query_map(params![limit as i64], row_to_event)
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
            summaries.push(self.get_daily_summary(date)?);
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

fn timeline_where_clause(
    service_id: Option<&str>,
    event_type: Option<TimelineEventType>,
    since_ms: Option<i64>,
) -> String {
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
    if conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", conditions.join(" AND "))
    }
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimelineEvent> {
    let ts_ms: i64 = row.get(1)?;
    let timestamp = DateTime::from_timestamp_millis(ts_ms).unwrap_or_else(Utc::now);
    let et_str: String = row.get(4)?;
    Ok(TimelineEvent {
        id: row.get(0)?,
        timestamp,
        service_id: row.get(2)?,
        service_name: row.get(3)?,
        event_type: TimelineEventType::from_db(&et_str),
        description: row.get(5)?,
        run_id: row.get(6)?,
    })
}
