use std::path::Path;

use super::types::*;
use crate::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};

pub(super) struct AgentDb {
    pub conn: Connection,
    _owner_lock: Connection,
}
fn db_error(error: rusqlite::Error) -> AppError {
    AppError::other(format!("Agent database: {error}"))
}

impl AgentDb {
    pub fn open(path: &Path) -> AppResult<Self> {
        // An OS-backed SQLite lock prevents another app process from recovering live turns.
        // Kept separate from the WAL database so normal reads/writes remain transactional.
        let owner_lock = Connection::open(path.with_extension("owner-lock")).map_err(db_error)?;
        owner_lock
            .busy_timeout(std::time::Duration::ZERO)
            .map_err(db_error)?;
        owner_lock.execute_batch("BEGIN EXCLUSIVE;").map_err(|_| {
            AppError::other("This agent workspace is already open in another RunHQ process")
        })?;
        let conn = Connection::open(path).map_err(db_error)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        let schema: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(db_error)?;
        if schema > 2 {
            return Err(AppError::other(
                "Agent database was created by a newer RunHQ version",
            ));
        }
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS agent_projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_items (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES agent_sessions(id), item_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session_id,item_id));
            CREATE INDEX IF NOT EXISTS agent_items_session ON agent_items(session_id,seq);
            CREATE TABLE IF NOT EXISTS agent_turn_requests (request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id));
            CREATE TABLE IF NOT EXISTS agent_tools (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_workspace_records (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            PRAGMA user_version=2;").map_err(db_error)?;
        Ok(Self {
            conn,
            _owner_lock: owner_lock,
        })
    }
    pub fn projects(&self) -> AppResult<Vec<AgentProject>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM agent_projects ORDER BY path")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(db_error)?;
        rows.map(|r| Ok(serde_json::from_str(&r.map_err(db_error)?)?))
            .collect()
    }
    pub fn project(&self, id: &str) -> AppResult<AgentProject> {
        let data: Option<String> = self
            .conn
            .query_row("SELECT data FROM agent_projects WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(db_error)?;
        serde_json::from_str(
            &data.ok_or_else(|| AppError::Invalid("Unknown agent project".into()))?,
        )
        .map_err(Into::into)
    }
    pub fn add_project(&self, project: &AgentProject) -> AppResult<AgentProject> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO agent_projects(id,path,data) VALUES(?1,?2,?3)",
                params![project.id, project.path, serde_json::to_string(project)?],
            )
            .map_err(db_error)?;
        let data: String = self
            .conn
            .query_row(
                "SELECT data FROM agent_projects WHERE path=?1",
                [&project.path],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        Ok(serde_json::from_str(&data)?)
    }
    pub fn sessions(&self) -> AppResult<Vec<AgentSession>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM agent_sessions")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(db_error)?;
        rows.map(|r| Ok(serde_json::from_str(&r.map_err(db_error)?)?))
            .collect()
    }
    pub fn save(&self, session: &AgentSession) -> AppResult<()> {
        self.conn.execute("INSERT INTO agent_sessions(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![session.id, serde_json::to_string(session)?]).map_err(db_error)?;
        Ok(())
    }
    pub fn delete_session(&self, id: &str) -> AppResult<()> {
        let tx = self.conn.unchecked_transaction().map_err(db_error)?;
        tx.execute("DELETE FROM agent_items WHERE session_id=?1", [id])
            .map_err(db_error)?;
        tx.execute("DELETE FROM agent_turn_requests WHERE session_id=?1", [id])
            .map_err(db_error)?;
        tx.execute("DELETE FROM agent_sessions WHERE id=?1", [id])
            .map_err(db_error)?;
        tx.execute(
            "DELETE FROM agent_workspace_records WHERE key=?1",
            [format!("context:{id}")],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub fn item(&self, session_id: &str, item: &AgentItem) -> AppResult<()> {
        self.conn.execute("INSERT INTO agent_items(session_id,item_id,data) VALUES(?1,?2,?3) ON CONFLICT(session_id,item_id) DO UPDATE SET data=excluded.data", params![session_id, item.id, serde_json::to_string(item)?]).map_err(db_error)?;
        Ok(())
    }
    pub fn items(
        &self,
        session_id: &str,
        before: Option<i64>,
    ) -> AppResult<(Vec<AgentItem>, Option<i64>)> {
        let mut stmt = self.conn.prepare("SELECT seq,data FROM agent_items WHERE session_id=?1 AND seq<?2 ORDER BY seq DESC LIMIT 201").map_err(db_error)?;
        let rows = stmt
            .query_map(params![session_id, before.unwrap_or(i64::MAX)], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_error)?;
        let mut rows = rows.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
        let more = rows.len() > 200;
        rows.truncate(200);
        let cursor = if more { rows.last().map(|r| r.0) } else { None };
        rows.reverse();
        Ok((
            rows.into_iter()
                .map(|(_, data)| serde_json::from_str(&data))
                .collect::<Result<Vec<_>, _>>()?,
            cursor,
        ))
    }
    pub fn request_owner(&self, id: &str) -> AppResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT session_id FROM agent_turn_requests WHERE request_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)
    }
    pub fn finish_activity(&self, session_id: &str) -> AppResult<()> {
        self.conn.execute("UPDATE agent_items SET data=json_set(data,'$.status','ended') WHERE session_id=?1 AND json_extract(data,'$.status') IN ('running','pending')", [session_id]).map_err(db_error)?;
        Ok(())
    }
    pub fn resolve_request(&self, session_id: &str, request_id: &str) -> AppResult<()> {
        self.conn.execute("UPDATE agent_items SET data=json_set(data,'$.status','completed') WHERE session_id=?1 AND item_id=?2", params![session_id, format!("request:{request_id}")]).map_err(db_error)?;
        Ok(())
    }
    pub fn record_request(&self, id: &str, session_id: &str) -> AppResult<()> {
        self.conn
            .execute(
                "INSERT INTO agent_turn_requests(request_id,session_id) VALUES(?1,?2)",
                params![id, session_id],
            )
            .map_err(db_error)?;
        Ok(())
    }
}
