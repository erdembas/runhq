use super::{invalid, now, AgentManager, AgentSession, CreateAgentSession};
use crate::{AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

fn sql_error(e: rusqlite::Error) -> AppError {
    AppError::other(format!("Agent workspace: {e}"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceRecord {
    pub key: String,
    pub value: Value,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
pub struct AgentContextFile {
    pub name: String,
    pub project_id: String,
    pub path: String,
    pub captured_at: i64,
    pub content: String,
}

/// Record kinds the app still reads and writes. Rows under retired prefixes (`recipe:`,
/// `schedule:`, `memory:`) stay in the database untouched but are neither listed nor written.
const RECORD_PREFIXES: [&str; 5] = ["context:", "preferences:", "link:", "pool:", "routing:"];

fn supported_record(key: &str) -> bool {
    RECORD_PREFIXES.iter().any(|prefix| key.starts_with(prefix))
}

fn ensure_records(conn: &rusqlite::Connection) -> AppResult<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS agent_workspace_records (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);").map_err(sql_error)
}

impl AgentManager {
    pub(super) fn workspace_record(&self, key: &str) -> AppResult<Option<WorkspaceRecord>> {
        let state = self.state.lock();
        ensure_records(&state.db.conn)?;
        state
            .db
            .conn
            .query_row(
                "SELECT data,updated_at FROM agent_workspace_records WHERE key=?1",
                [key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(sql_error)?
            .map(|(data, updated_at)| {
                Ok(WorkspaceRecord {
                    key: key.into(),
                    value: serde_json::from_str(&data)?,
                    updated_at,
                })
            })
            .transpose()
    }
    pub async fn handoff_create(
        self: &std::sync::Arc<Self>,
        source_id: &str,
        mut input: CreateAgentSession,
    ) -> AppResult<AgentSession> {
        static HANDOFF_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let _guard = HANDOFF_GATE.lock().await;
        let request_id = input
            .creation_request_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if uuid::Uuid::parse_str(&request_id).is_err() {
            return Err(invalid("A valid creation request ID is required"));
        }
        input.creation_request_id = Some(request_id.clone());
        input.isolated = false;
        let intent_key = format!("preferences:handoff:{request_id}");
        let link_key = format!("link:{request_id}");
        let prior = self.workspace_record(&intent_key)?;
        let snapshot = if let Some(intent) = prior {
            if intent.value["sourceSessionId"].as_str() != Some(source_id) {
                return Err(invalid(
                    "This handoff request belongs to a different source task",
                ));
            }
            input.project_id = intent.value["projectId"]
                .as_str()
                .ok_or_else(|| invalid("Invalid saved handoff project"))?
                .into();
            let input_value = serde_json::to_value(&input)?;
            if intent.value["input"] != input_value {
                return Err(invalid(
                    "This handoff request was already used with different task settings",
                ));
            }
            if let Some(link) = self.workspace_record(&link_key)? {
                if link.value["sourceSessionId"].as_str() != Some(source_id) {
                    return Err(invalid("Saved handoff source does not match"));
                }
                // Idempotent retries never rewrite a target that may already have
                // started, completed, or received additional user instructions.
                return self.session(&request_id).map_err(|_| {
                    invalid("The task created by this handoff was deleted. Start a new handoff.")
                });
            }
            intent.value
        } else {
            if self.session(&request_id).is_ok()
                || self
                    .workspace_record(&format!("preferences:creation:{request_id}"))?
                    .is_some()
            {
                return Err(invalid(
                    "This creation request already belongs to another task",
                ));
            }
            let source = self.session(source_id)?;
            if source.active() {
                return Err(invalid(
                    "Wait for the source task to stop before handing it off",
                ));
            }
            if source
                .runtime_state
                .get("history_only")
                .and_then(Value::as_bool)
                == Some(true)
            {
                return Err(invalid(
                    "Imported history can be added as context to a new task",
                ));
            }
            input.project_id = source.project_id.clone();
            let cwd = Path::new(&source.cwd).canonicalize().map_err(|_| {
                invalid("The source task workspace is missing; restore it before handing it off")
            })?;
            if !cwd.is_dir() {
                return Err(invalid("The source task workspace is not a directory"));
            }
            let input_value = serde_json::to_value(&input)?;
            let revision = super::git_output(&cwd, &["rev-parse", "HEAD"])
                .await
                .ok()
                .map(|s| s.trim().to_string());
            serde_json::json!({"sourceSessionId":source_id,"projectId":source.project_id,"cwd":cwd.to_string_lossy(),"branch":source.branch,"isolated":source.isolated,"sourceRevision":source.revision,"baseRevision":revision,"createdAt":now(),"input":input_value})
        };
        let cwd = Path::new(
            snapshot["cwd"]
                .as_str()
                .ok_or_else(|| invalid("Invalid saved handoff workspace"))?,
        )
        .canonicalize()
        .map_err(|_| invalid("The saved handoff workspace is missing"))?;
        let source = self.session(source_id)?;
        if source.active() || source.runtime_state["history_only"] == true {
            return Err(invalid("Stop the source task before handing it off"));
        }
        if Path::new(&source.cwd).canonicalize()? != cwd || source.project_id != input.project_id {
            return Err(invalid(
                "The source workspace changed since this handoff was prepared",
            ));
        }
        self.workspace_save(intent_key, Some(snapshot.clone()))?;
        let created = self.create(input).await?;
        let link = serde_json::json!({"sourceSessionId":source_id,"targetSessionId":created.id,"kind":"handoff","createdAt":snapshot["createdAt"],"cwd":snapshot["cwd"],"branch":snapshot["branch"],"baseRevision":snapshot["baseRevision"],"sourceRevision":snapshot["sourceRevision"]});
        self.mutate(&created.id, |session, db| {
            if session.status != "idle" || session.native_id.is_some() {
                return Err(invalid("The recovered target already started. Its workspace was left untouched; inspect it before creating another handoff."));
            }
            session.cwd = cwd.to_string_lossy().into();
            session.workspace = source.workspace.clone();
            session.branch = snapshot["branch"].as_str().map(str::to_string);
            session.isolated = snapshot["isolated"].as_bool().unwrap_or(false);
            // Session binding and provenance commit atomically, before the session
            // event is emitted. There is no half-linked target after a restart.
            db.conn.execute("INSERT INTO agent_workspace_records(key,data,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", params![link_key, serde_json::to_string(&link)?, now()]).map_err(sql_error)?;
            Ok(())
        })?;
        self.session(&created.id)
    }
    pub fn workspace_records(&self) -> AppResult<Vec<WorkspaceRecord>> {
        let state = self.state.lock();
        ensure_records(&state.db.conn)?;
        let mut stmt = state
            .db
            .conn
            .prepare(
                "SELECT key,data,updated_at FROM agent_workspace_records ORDER BY updated_at DESC",
            )
            .map_err(sql_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(sql_error)?;
        let mut records = vec![];
        for row in rows {
            let (key, data, updated_at) = row.map_err(sql_error)?;
            if supported_record(&key) {
                records.push(WorkspaceRecord {
                    key,
                    value: serde_json::from_str(&data)?,
                    updated_at,
                });
            }
        }
        Ok(records)
    }

    pub fn workspace_save(&self, key: String, value: Option<Value>) -> AppResult<()> {
        let workspace_permission = key.starts_with(super::permissions::WORKSPACE_PERMISSION_PREFIX);
        if key.len() > if workspace_permission { 8192 } else { 160 } || !supported_record(&key) {
            return Err(invalid("Unknown workspace record type"));
        }
        if let Some(value) = &value {
            if workspace_permission && !super::permissions::valid_workspace_permission(&key, value)
            {
                return Err(invalid("Invalid workspace permission grant"));
            }
            if key == "preferences:permissions"
                && !super::permissions::valid_policy(&value["policy"])
            {
                return Err(invalid("Unknown agent permission policy"));
            }
            let limit = if key.starts_with("context:") {
                4 * 1024 * 1024
            } else {
                1024 * 1024
            };
            if serde_json::to_vec(value)?.len() > limit {
                return Err(invalid("Workspace record exceeds its storage limit"));
            }
            if key == "preferences:capacity" {
                let limit = value.get("global").and_then(Value::as_u64).unwrap_or(8);
                if !(1..=8).contains(&limit) {
                    return Err(invalid("Global concurrency must be between 1 and 8"));
                }
                if let Some(providers) = value.get("providers").and_then(Value::as_object) {
                    for limit in providers.values() {
                        if !limit.as_u64().is_some_and(|n| (1..=8).contains(&n)) {
                            return Err(invalid("Provider concurrency must be between 1 and 8"));
                        }
                    }
                }
            }
        }
        let state = self.state.lock();
        ensure_records(&state.db.conn)?;
        match value {
            Some(value) => {
                state.db.conn.execute("INSERT INTO agent_workspace_records(key,data,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", params![key, serde_json::to_string(&value)?, now()]).map_err(sql_error)?;
            }
            None => {
                state
                    .db
                    .conn
                    .execute("DELETE FROM agent_workspace_records WHERE key=?1", [key])
                    .map_err(sql_error)?;
            }
        }
        Ok(())
    }

    pub(super) fn capacity_limits(
        conn: &rusqlite::Connection,
        backend: &str,
    ) -> AppResult<(usize, usize)> {
        ensure_records(conn)?;
        let data: Option<String> = conn
            .query_row(
                "SELECT data FROM agent_workspace_records WHERE key='preferences:capacity'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql_error)?;
        let value: Value = data
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or(Value::Null);
        Ok((
            value["global"].as_u64().unwrap_or(8).clamp(1, 8) as usize,
            value["providers"][backend]
                .as_u64()
                .unwrap_or(8)
                .clamp(1, 8) as usize,
        ))
    }

    pub fn context_file(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        relative_path: &str,
    ) -> AppResult<AgentContextFile> {
        let project = self.state.lock().db.project(project_id)?;
        let root = if let Some(id) = session_id {
            let session = self.session(id)?;
            if session.project_id != project_id {
                return Err(invalid("Context belongs to a different project"));
            }
            session.cwd
        } else {
            project.path
        };
        let root = Path::new(&root).canonicalize()?;
        let path = root.join(relative_path).canonicalize()?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err(invalid("Choose a file inside this task's workspace"));
        }
        if path.metadata()?.len() > 192 * 1024 {
            return Err(invalid("File exceeds 192 KiB; attach a selected excerpt"));
        }
        use std::io::Read;
        let mut content = String::new();
        std::fs::File::open(&path)?
            .take(192 * 1024 + 1)
            .read_to_string(&mut content)?;
        if content.len() > 192 * 1024 {
            return Err(invalid("File exceeds 192 KiB; attach a selected excerpt"));
        }
        Ok(AgentContextFile {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            project_id: project_id.into(),
            path: path.to_string_lossy().into_owned(),
            captured_at: now(),
            content,
        })
    }
}
