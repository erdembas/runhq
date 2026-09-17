//! Durable, UI-independent agent sessions. Provider protocols live in the bundled runtime.
mod db;
mod discovery;
mod process;
mod registry;
#[cfg(test)]
mod tests;
mod types;

use crate::{AppError, AppResult};
use db::AgentDb;
pub use discovery::agent_command_path;
use parking_lot::Mutex;
#[cfg(test)]
use process::executable;
use process::{cursor_acp, frame, node_executable, version, OwnedProcess};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};
pub use types::*;

type ChangeSink = Arc<dyn Fn(&AgentSession) + Send + Sync>;
struct Control {
    value: Value,
    reply: oneshot::Sender<Result<(), String>>,
}
struct Running {
    run_id: String,
    cwd: PathBuf,
    sender: mpsc::Sender<Control>,
}
struct State {
    db: AgentDb,
    sessions: HashMap<String, AgentSession>,
    running: HashMap<String, Running>,
    tools: HashMap<String, AgentTool>,
}

pub struct AgentManager {
    state: Mutex<State>,
    home: PathBuf,
    bridge: PathBuf,
    sink: ChangeSink,
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}

impl AgentManager {
    pub fn open(home: &Path, bridge: PathBuf, sink: ChangeSink) -> AppResult<Self> {
        std::fs::create_dir_all(home)?;
        let db = AgentDb::open(&home.join("agents.db"))?;
        let mut tools: HashMap<String, AgentTool> = registry::defaults()
            .into_iter()
            .map(|t| (t.id.clone(), t))
            .collect();
        {
            let mut stmt = db
                .conn
                .prepare("SELECT data FROM agent_tools")
                .map_err(|e| AppError::other(e.to_string()))?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| AppError::other(e.to_string()))?;
            for row in rows {
                let tool: AgentTool =
                    serde_json::from_str(&row.map_err(|e| AppError::other(e.to_string()))?)?;
                tools.insert(tool.id.clone(), tool);
            }
        }
        let mut sessions = HashMap::new();
        for mut session in db.sessions()? {
            if session.active() {
                session.status = "interrupted".into();
                session.last_error = Some("RunHQ exited while this turn was active. Review the workspace before continuing; no request was replayed.".into());
                session.pending.clear();
                session.unread = true;
                session.revision += 1;
                db.finish_activity(&session.id)?;
                db.save(&session)?;
            }
            sessions.insert(session.id.clone(), session);
        }
        Ok(Self {
            state: Mutex::new(State {
                db,
                tools,
                sessions,
                running: HashMap::new(),
            }),
            home: home.into(),
            bridge,
            sink,
        })
    }
    pub fn add_project(&self, name: String, path: PathBuf) -> AppResult<AgentProject> {
        let path = path.canonicalize()?;
        if !path.is_dir() {
            return Err(invalid("Choose a project directory"));
        }
        let fallback = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        self.state.lock().db.add_project(&AgentProject {
            id: uuid::Uuid::new_v4().to_string(),
            name: if name.trim().is_empty() {
                fallback
            } else {
                name.chars().take(200).collect()
            },
            path: path.to_string_lossy().to_string(),
        })
    }
    pub fn projects(&self) -> AppResult<Vec<AgentProject>> {
        self.state.lock().db.projects()
    }
    pub fn sessions(&self) -> Vec<AgentSession> {
        let mut sessions: Vec<_> = self.state.lock().sessions.values().cloned().collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        sessions
    }
    /// Read session metadata without loading and deserializing its transcript.
    pub fn session(&self, id: &str) -> AppResult<AgentSession> {
        self.state
            .lock()
            .sessions
            .get(id)
            .cloned()
            .ok_or_else(|| invalid("Unknown agent session"))
    }
    pub fn snapshot(&self, id: &str, before: Option<i64>) -> AppResult<AgentSnapshot> {
        let state = self.state.lock();
        let session = state
            .sessions
            .get(id)
            .cloned()
            .ok_or_else(|| invalid("Unknown agent session"))?;
        let (items, before) = state.db.items(id, before)?;
        Ok(AgentSnapshot {
            session,
            items,
            before,
        })
    }
    fn mutate(
        &self,
        id: &str,
        change: impl FnOnce(&mut AgentSession, &AgentDb) -> AppResult<()>,
    ) -> AppResult<AgentSession> {
        let updated = {
            let mut state = self.state.lock();
            let mut session = state
                .sessions
                .get(id)
                .cloned()
                .ok_or_else(|| invalid("Unknown agent session"))?;
            let tx = state
                .db
                .conn
                .unchecked_transaction()
                .map_err(|e| AppError::other(e.to_string()))?;
            change(&mut session, &state.db)?;
            session.updated_at = now();
            session.revision += 1;
            state.db.save(&session)?;
            tx.commit().map_err(|e| AppError::other(e.to_string()))?;
            state.sessions.insert(id.into(), session.clone());
            session
        };
        (self.sink)(&updated);
        Ok(updated)
    }
    pub fn update(
        &self,
        id: &str,
        title: Option<String>,
        archived: Option<bool>,
        read: bool,
    ) -> AppResult<AgentSession> {
        self.mutate(id, |s, _| {
            if let Some(title) = title {
                if title.trim().is_empty() || title.len() > 800 {
                    return Err(invalid("Title must contain 1–200 characters"));
                }
                s.title = title.chars().take(200).collect();
            }
            if let Some(archived) = archived {
                if s.active() {
                    return Err(invalid("Stop the active turn before archiving"));
                }
                s.archived = archived;
            }
            if read {
                s.unread = false;
            }
            Ok(())
        })
    }
    pub fn delete_session(&self, id: &str) -> AppResult<()> {
        let mut state = self.state.lock();
        if state.running.contains_key(id) || state.sessions.get(id).is_some_and(|s| s.active()) {
            return Err(invalid(
                "Stop the active turn before deleting this conversation",
            ));
        }
        // Only remove RunHQ history. Project directories, worktrees and provider-owned
        // session files remain untouched. The lock also excludes concurrent starts.
        state.db.delete_session(id)?;
        state.sessions.remove(id);
        Ok(())
    }
    pub async fn detect(&self) -> Vec<AgentBackend> {
        let runtime_error = if !self.bridge.is_file() {
            Some("Agent runtime is missing. Build with pnpm agent:build.".to_string())
        } else {
            node_executable().await.err().map(|error| error.to_string())
        };
        let mut tools = self.tools().into_iter();
        let mut result = Vec::new();
        while let Some(first) = tools.next() {
            let (first, second, third, fourth) = tokio::join!(
                detect_tool(Some(first), &runtime_error),
                detect_tool(tools.next(), &runtime_error),
                detect_tool(tools.next(), &runtime_error),
                detect_tool(tools.next(), &runtime_error),
            );
            result.extend([first, second, third, fourth].into_iter().flatten());
        }
        result
    }
    async fn bridge_command(&self) -> AppResult<Command> {
        if !self.bridge.is_file() {
            return Err(invalid(
                "Agent runtime is missing. Run pnpm agent:build and restart RunHQ.",
            ));
        }
        let node = node_executable().await?;
        let mut cmd = Command::new(&node);
        if let Some(path) = agent_command_path(&node) {
            cmd.env("PATH", path);
        }
        cmd.arg(&self.bridge);
        #[cfg(unix)]
        cmd.env("RUNHQ_AGENT_PROCESS_GROUP", "1");
        Ok(cmd)
    }
    pub async fn catalog(
        &self,
        backend: String,
        path: String,
        project_id: String,
        session_id: Option<String>,
        model: Option<String>,
    ) -> AppResult<Value> {
        let mut tool = self.tool(&backend)?;
        if let Some(id) = session_id {
            let previous = self.session(&id)?;
            if previous.backend != backend || previous.project_id != project_id {
                return Err(invalid("Session does not belong to this tool and project"));
            }
            tool.adapter = if previous.adapter.is_empty() {
                previous.backend
            } else {
                previous.adapter
            };
            tool.args = previous.args;
            tool.executable = previous.executable;
        }
        if tool.adapter == "terminal" {
            return Err(invalid(
                "Terminal tools use their own model and permission interface",
            ));
        }
        let project = self.state.lock().db.project(&project_id)?;
        let executable = resolve_executable(&tool.executable, &path)?;
        let mut cmd = self.bridge_command().await?;
        if let Some(path) = agent_command_path(Path::new(&executable)) {
            cmd.env("PATH", path);
        }
        cmd.current_dir(&project.path);
        let mut child = OwnedProcess::spawn(cmd)?;
        let mut stdin = child
            .child
            .stdin
            .take()
            .ok_or_else(|| AppError::other("Missing agent input"))?;
        let stdout = child
            .child
            .stdout
            .take()
            .ok_or_else(|| AppError::other("Missing agent output"))?;
        stdin.write_all(format!("{}\n", json!({"type":"start","config":{"operation":"catalog","model":model,"backend":backend,"adapter":tool.adapter,"args":tool.args,"executable":executable,"cwd":project.path,"mode":"default"}})).as_bytes()).await?;
        let result = tokio::time::timeout(Duration::from_secs(60), async {
            let mut reader = BufReader::new(stdout);
            while let Some(event) = frame(&mut reader).await? {
                if event["type"] == "catalog" {
                    return Ok(event["catalog"].clone());
                }
                if event["type"] == "finished" {
                    return Err(AppError::other(
                        event["error"]
                            .as_str()
                            .unwrap_or("Could not load agent capabilities"),
                    ));
                }
            }
            Err(AppError::other("Agent exited without a model catalog"))
        })
        .await
        .map_err(|_| AppError::other("Agent capability discovery timed out"))?;
        child.stop();
        let _ = child.child.wait().await;
        result
    }
    pub async fn create(&self, input: CreateAgentSession) -> AppResult<AgentSession> {
        let tool = self.tool(&input.backend)?;
        if tool.adapter == "terminal" {
            return Err(invalid("Open this tool from Agent tools as a terminal"));
        }
        if !["default", "plan"].contains(&input.mode.as_str()) {
            return Err(invalid("Unknown permission mode"));
        }
        let executable = resolve_executable(&tool.executable, &input.executable)?;
        let project = self.state.lock().db.project(&input.project_id)?;
        let original = PathBuf::from(&project.path).canonicalize()?;
        let id = uuid::Uuid::new_v4().to_string();
        let mut cwd = original.clone();
        let mut branch = None;
        if input.isolated {
            let root = git_output(&original, &["rev-parse", "--show-toplevel"]).await?;
            let root = PathBuf::from(root.trim()).canonicalize()?;
            let relative = original
                .strip_prefix(&root)
                .map_err(|_| invalid("Project is outside its Git repository"))?;
            let dir = self.home.join("worktrees").join(&id);
            std::fs::create_dir_all(
                dir.parent()
                    .ok_or_else(|| invalid("Invalid worktree path"))?,
            )?;
            let name = format!("codex/runhq-{}", &id[..8]);
            git_output(
                &root,
                &[
                    "worktree",
                    "add",
                    "-b",
                    &name,
                    &dir.to_string_lossy(),
                    "HEAD",
                ],
            )
            .await?;
            cwd = dir.join(relative);
            if !cwd.is_dir() {
                return Err(invalid("Project directory is not present in HEAD. The new worktree was preserved for inspection."));
            }
            branch = Some(name);
        }
        let session = AgentSession {
            id: id.clone(),
            project_id: project.id,
            project_name: project.name,
            cwd: cwd.to_string_lossy().into(),
            backend: input.backend,
            adapter: tool.adapter,
            backend_name: tool.name,
            args: tool.args,
            executable,
            title: if input.title.trim().is_empty() {
                "New task".into()
            } else {
                input.title.chars().take(200).collect()
            },
            model: input.model,
            effort: input.effort,
            mode: input.mode,
            agent: input.agent,
            native_id: None,
            status: "idle".into(),
            created_at: now(),
            updated_at: now(),
            revision: 1,
            archived: false,
            unread: false,
            last_error: None,
            isolated: input.isolated,
            branch,
            usage: Value::Null,
            runtime_state: Value::Null,
            pending: vec![],
        };
        {
            let mut state = self.state.lock();
            state.db.save(&session)?;
            state.sessions.insert(id, session.clone());
        }
        (self.sink)(&session);
        Ok(session)
    }
    pub async fn start(self: &Arc<Self>, input: AgentTurnInput) -> AppResult<AgentSession> {
        if input.prompt.trim().is_empty() || input.prompt.len() > 256 * 1024 {
            return Err(invalid("Message must contain 1–262144 bytes"));
        }
        if uuid::Uuid::parse_str(&input.request_id).is_err() {
            return Err(invalid("A unique message request ID is required"));
        }
        if let Some(mode) = &input.mode {
            if !["default", "plan"].contains(&mode.as_str()) {
                return Err(invalid("Unknown permission mode"));
            }
        }
        let previous = self.session(&input.session_id)?;
        self.tool(&previous.backend)?;
        let cwd = PathBuf::from(&previous.cwd).canonicalize()?;
        // Serialize writers by actual checkout root, including monorepo service subdirectories.
        let lease_path = git_output(&cwd, &["rev-parse", "--show-toplevel"])
            .await
            .ok()
            .and_then(|p| PathBuf::from(p.trim()).canonicalize().ok())
            .unwrap_or(cwd.clone());
        let mut cmd = self.bridge_command().await?;
        if let Some(path) = agent_command_path(Path::new(&previous.executable)) {
            cmd.env("PATH", path);
        }
        cmd.current_dir(&cwd);
        let run_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel(32);
        let session = {
            let mut state = self.state.lock();
            if let Some(owner) = state.db.request_owner(&input.request_id)? {
                if owner != input.session_id {
                    return Err(invalid("Request ID belongs to another session"));
                }
                return state
                    .sessions
                    .get(&owner)
                    .cloned()
                    .ok_or_else(|| invalid("Unknown session"));
            }
            let mut session = state
                .sessions
                .get(&input.session_id)
                .cloned()
                .ok_or_else(|| invalid("Unknown session"))?;
            if !state
                .tools
                .get(&session.backend)
                .is_some_and(|tool| tool.enabled)
            {
                return Err(invalid("This tool is disabled. Enable it in Agent tools."));
            }
            if session.archived {
                return Err(invalid("Restore this session before sending a message"));
            }
            if session.active() || state.running.contains_key(&session.id) {
                return Err(invalid("This session already has an active turn"));
            }
            if state.running.len() >= 8 {
                return Err(invalid(
                    "Eight turns are active. Wait for a turn to finish before starting another.",
                ));
            }
            if state
                .running
                .values()
                .any(|r| r.cwd.starts_with(&lease_path) || lease_path.starts_with(&r.cwd))
            {
                return Err(invalid("Another agent owns this checkout. Wait for it to finish or create an isolated worktree session."));
            }
            if let Some(mode) = &input.mode {
                session.mode = mode.clone();
            }
            if let Some(agent) = &input.agent {
                session.agent = agent.clone();
            }
            session.model = input.model.clone();
            session.effort = input.effort.clone();
            session.status = "starting".into();
            session.last_error = None;
            session.pending.clear();
            session.unread = false;
            session.revision += 1;
            session.updated_at = now();
            let tx = state
                .db
                .conn
                .unchecked_transaction()
                .map_err(|e| AppError::other(e.to_string()))?;
            state.db.save(&session)?;
            state.db.record_request(&input.request_id, &session.id)?;
            state.db.item(
                &session.id,
                &AgentItem {
                    id: input.request_id.clone(),
                    kind: "user".into(),
                    title: "You".into(),
                    text: input.prompt.clone(),
                    status: "completed".into(),
                    created_at: now(),
                },
            )?;
            tx.commit().map_err(|e| AppError::other(e.to_string()))?;
            state.sessions.insert(session.id.clone(), session.clone());
            state.running.insert(
                session.id.clone(),
                Running {
                    run_id: run_id.clone(),
                    cwd: lease_path,
                    sender,
                },
            );
            session
        };
        (self.sink)(&session);
        let manager = self.clone();
        let running_session = session.clone();
        tokio::spawn(async move {
            let result = manager
                .run(&running_session, &run_id, &input.prompt, cmd, receiver)
                .await;
            // Release the lease before advertising a terminal status, under the same state lock.
            manager.state.lock().running.remove(&running_session.id);
            let (status, error) = result.unwrap_or_else(|e| ("failed".into(), Some(e.to_string())));
            if let Err(error) = manager.mutate(&running_session.id, |s, db| {
                db.finish_activity(&s.id)?;
                s.status = status;
                s.last_error = error;
                s.pending.clear();
                s.unread = true;
                Ok(())
            }) {
                tracing::error!("could not persist agent completion: {error}");
            }
        });
        Ok(session)
    }
    async fn run(
        &self,
        session: &AgentSession,
        run_id: &str,
        prompt: &str,
        cmd: Command,
        mut controls: mpsc::Receiver<Control>,
    ) -> AppResult<(String, Option<String>)> {
        let mut child = OwnedProcess::spawn(cmd)?;
        let mut stdin = child
            .child
            .stdin
            .take()
            .ok_or_else(|| AppError::other("Missing bridge input"))?;
        let mut reader = BufReader::new(
            child
                .child
                .stdout
                .take()
                .ok_or_else(|| AppError::other("Missing bridge output"))?,
        );
        let config = json!({"operation":"turn", "backend":session.backend,"adapter":if session.adapter.is_empty(){&session.backend}else{&session.adapter},"args":session.args,"runtime_state":session.runtime_state,"executable":session.executable,"cwd":session.cwd,"native_id":session.native_id,"title":session.title,"mode":session.mode,"model":session.model,"effort":session.effort,"agent":session.agent,"prompt":prompt});
        stdin
            .write_all(format!("{}\n", json!({"type":"start","config":config})).as_bytes())
            .await?;
        let (event_tx, mut event_rx) = mpsc::channel(64);
        let reader_task = tokio::spawn(async move {
            loop {
                let result = frame(&mut reader).await;
                let ended = !matches!(&result, Ok(Some(_)));
                if event_tx.send(result).await.is_err() || ended {
                    break;
                }
            }
        });
        let mut pending: HashMap<String, oneshot::Sender<Result<(), String>>> = HashMap::new();
        let mut cancel_deadline = None;
        let result = loop {
            tokio::select! {
                control = controls.recv() => {
                    let Some(mut control) = control else { break Ok(("interrupted".into(), Some("Agent manager disconnected".into()))); };
                    if control.value["type"] == "interrupt" {
                        cancel_deadline = Some(tokio::time::Instant::now() + Duration::from_secs(15));
                    }
                    let id = uuid::Uuid::new_v4().to_string(); control.value["command_id"] = json!(id);
                    if let Err(e) = stdin.write_all(format!("{}\n", control.value).as_bytes()).await {
                        let _ = control.reply.send(Err(e.to_string())); break Err(e.into());
                    }
                    pending.insert(id, control.reply);
                }
                event = event_rx.recv() => {
                    let Some(event) = event.transpose()?.flatten() else { break Err(AppError::other("Agent runtime disconnected. Review the workspace before resuming.")); };
                    match event["type"].as_str().unwrap_or("") {
                        "ack" | "command_error" => {
                            if let Some(reply) = event["command_id"].as_str().and_then(|id| pending.remove(id)) {
                                let value = if event["type"] == "ack" { Ok(()) } else { Err(event["message"].as_str().unwrap_or("Agent command failed").into()) };
                                let _ = reply.send(value);
                            }
                        }
                        "finished" => {
                            let status = match event["status"].as_str() { Some("completed") => "completed", Some("cancelled") => "cancelled", _ => "failed" };
                            break Ok((status.into(), event["error"].as_str().map(str::to_string)));
                        }
                        _ => { self.apply_event(&session.id, run_id, event)?; }
                    }
                }
                _ = tokio::time::sleep_until(cancel_deadline.unwrap_or_else(|| tokio::time::Instant::now() + Duration::from_secs(86400))), if cancel_deadline.is_some() => {
                    break Ok(("interrupted".into(), Some("The agent did not stop within 15 seconds. RunHQ terminated its owned process tree; review partial changes before continuing.".into())));
                }
            }
        };
        child.stop();
        let _ = child.child.wait().await;
        reader_task.abort();
        for (_, reply) in pending {
            let _ = reply.send(Err("The turn has ended".into()));
        }
        result
    }
    fn apply_event(&self, id: &str, run_id: &str, event: Value) -> AppResult<()> {
        self.mutate(id, |s, db| {
            match event["type"].as_str().unwrap_or("") {
                "native" => s.native_id = event["id"].as_str().map(str::to_string),
                "status" if s.status != "cancelling" && s.pending.is_empty() => {
                    s.status = "running".into()
                }
                "item" => {
                    let mut item: AgentItem = serde_json::from_value(event["item"].clone())?;
                    item.id = format!("{run_id}:{}", item.id);
                    item.created_at = now();
                    db.item(id, &item)?;
                }
                "request" => {
                    let mut request: AgentRequest =
                        serde_json::from_value(event["request"].clone())?;
                    request.native_id = request.id.clone();
                    request.id = format!("{run_id}:{}", request.id);
                    db.item(
                        id,
                        &AgentItem {
                            id: format!("request:{}", request.id),
                            kind: "request".into(),
                            title: request.title.clone(),
                            text: if request.kind == "question" {
                                serde_json::to_string_pretty(&request.questions)?
                            } else {
                                request.details.clone()
                            },
                            status: "pending".into(),
                            created_at: now(),
                        },
                    )?;
                    if !s.pending.iter().any(|r| r.id == request.id) {
                        s.pending.push(request);
                    }
                    s.unread = true;
                    if s.status != "cancelling" {
                        s.status = waiting_status(&s.pending);
                    }
                }
                "resolved" => {
                    let key = format!("{run_id}:{}", event["id"].as_str().unwrap_or(""));
                    db.resolve_request(id, &key)?;
                    s.pending.retain(|r| r.id != key);
                    if s.status != "cancelling" {
                        s.status = waiting_status(&s.pending);
                    }
                }
                "state" => s.runtime_state = event["state"].clone(),
                "usage" => s.usage = event["usage"].clone(),
                _ => {}
            }
            Ok(())
        })?;
        Ok(())
    }
    async fn control(&self, id: &str, value: Value) -> AppResult<()> {
        let sender = self
            .state
            .lock()
            .running
            .get(id)
            .map(|r| r.sender.clone())
            .ok_or_else(|| invalid("This turn is no longer active"))?;
        let (reply, receive) = oneshot::channel();
        sender
            .send(Control { value, reply })
            .await
            .map_err(|_| invalid("The turn has ended"))?;
        tokio::time::timeout(Duration::from_secs(50), receive)
            .await
            .map_err(|_| {
                AppError::other(
                    "Agent command was not acknowledged. Refresh the session before retrying.",
                )
            })?
            .map_err(|_| AppError::other("Agent command channel closed"))?
            .map_err(AppError::other)
    }
    pub async fn answer(&self, id: &str, request_id: &str, value: Value) -> AppResult<()> {
        if serde_json::to_vec(&value)?.len() > 256 * 1024 {
            return Err(invalid("Answer is too large"));
        }
        let request = {
            let state = self.state.lock();
            let runtime = state
                .running
                .get(id)
                .ok_or_else(|| invalid("The turn has ended"))?;
            let session = state
                .sessions
                .get(id)
                .ok_or_else(|| invalid("Unknown session"))?;
            if session.status == "cancelling" {
                return Err(invalid("This turn is stopping"));
            }
            let request = session
                .pending
                .iter()
                .find(|r| r.id == request_id && r.id.starts_with(&format!("{}:", runtime.run_id)))
                .ok_or_else(|| invalid("This request is no longer pending"))?;
            request.clone()
        };
        self.control(
            id,
            json!({"type":"answer","id":request.native_id,"value":value}),
        )
        .await?;
        let mut recorded = value;
        // MCP forms can contain credentials; retain the decision, not arbitrary form secrets.
        if request.kind == "form" && recorded.get("content").is_some() {
            recorded["content"] = json!("[form content not retained]");
        }
        if let Some(questions) = request.questions.as_array() {
            for question in questions {
                if question["secret"] == true {
                    if let Some(key) = question["id"].as_str() {
                        if recorded["answers"].get(key).is_some() {
                            recorded["answers"][key] = json!(["[redacted]"]);
                        }
                    }
                }
            }
        }
        self.mutate(id, |_, db| {
            db.item(
                id,
                &AgentItem {
                    id: format!("answer:{request_id}"),
                    kind: "user".into(),
                    title: "Your response".into(),
                    text: serde_json::to_string_pretty(&recorded)?,
                    status: "completed".into(),
                    created_at: now(),
                },
            )
        })?;
        Ok(())
    }
    pub async fn interrupt(&self, id: &str) -> AppResult<()> {
        self.mutate(id, |s, _| {
            if !s.active() {
                return Err(invalid("This turn is no longer active"));
            }
            s.status = "cancelling".into();
            Ok(())
        })?;
        self.control(id, json!({"type":"interrupt"})).await
    }
    pub async fn steer(&self, id: &str, text: String) -> AppResult<()> {
        if text.trim().is_empty() || text.len() > 256 * 1024 {
            return Err(invalid("Invalid steering message"));
        }
        let s = self.session(id)?;
        if (if s.adapter.is_empty() {
            &s.backend
        } else {
            &s.adapter
        }) != "codex"
            || s.status != "running"
        {
            return Err(invalid(
                "Steering is available while a Codex turn is running",
            ));
        }
        self.control(id, json!({"type":"steer","text":text}))
            .await?;
        self.mutate(id, |_, db| {
            db.item(
                id,
                &AgentItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    kind: "user".into(),
                    title: "You · steering".into(),
                    text,
                    status: "completed".into(),
                    created_at: now(),
                },
            )
        })?;
        Ok(())
    }
}

// Four probes at a time bound process pressure while preventing one slow CLI
// from delaying every other tool's version check.
async fn detect_tool(
    tool: Option<AgentTool>,
    runtime_error: &Option<String>,
) -> Option<AgentBackend> {
    let tool = tool?;
    let resolved = discovery::resolve(&tool.executable);
    let path = resolved.as_ref().map(|found| &found.path);
    let checked = match path {
        Some(_) if resolved.as_ref().is_some_and(|found| !found.runnable) => Err(invalid(
            "The configured file is not executable. Fix its permissions or choose another CLI.",
        )),
        Some(p) if tool.id == "cursor" && tool.adapter == "acp" => {
            cursor_acp(p, &tool.args).await.map(|_| None)
        }
        Some(p) if ["codex", "opencode", "claude"].contains(&tool.adapter.as_str()) => {
            version(p).await.map(Some)
        }
        Some(_) => Ok(None),
        None => Err(invalid(format!(
            "Executable not found: {}",
            tool.executable
        ))),
    };
    let error = if path.is_some() && tool.adapter != "terminal" && runtime_error.is_some() {
        runtime_error.clone()
    } else {
        checked.as_ref().err().map(ToString::to_string)
    };
    let detection_status = if resolved.is_none() {
        AgentDetectionStatus::NotFound
    } else if error.is_some() {
        AgentDetectionStatus::Blocked
    } else {
        AgentDetectionStatus::Available
    };
    Some(AgentBackend {
        id: tool.id,
        name: tool.name,
        adapter: tool.adapter,
        enabled: tool.enabled,
        command: tool.executable,
        args: tool.args,
        executable: path.map(|p| p.to_string_lossy().into()),
        detection_status,
        detection_source: resolved.as_ref().map(|found| found.source),
        version: checked.ok().flatten(),
        available: error.is_none(),
        error,
    })
}

fn waiting_status(requests: &[AgentRequest]) -> String {
    if requests
        .iter()
        .any(|r| r.kind == "question" || r.kind == "form")
    {
        "waiting_input"
    } else if !requests.is_empty() {
        "waiting_permission"
    } else {
        "running"
    }
    .into()
}
fn resolve_executable(backend: &str, path: &str) -> AppResult<String> {
    let selected = if path.trim().is_empty() {
        backend
    } else {
        path
    };
    match discovery::resolve(selected) {
        Some(found) if found.runnable => Ok(found.path.to_string_lossy().into()),
        Some(_) => Err(invalid(format!("File is not executable: {selected}"))),
        None => Err(invalid(format!("Executable not found: {selected}"))),
    }
}
async fn git_output(cwd: &Path, args: &[&str]) -> AppResult<String> {
    let mut command = Command::new("git");
    command.args(args).kill_on_drop(true);
    crate::git::configure_git_cmd(command.as_std_mut(), cwd);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| AppError::other("Git operation timed out"))??;
    if !output.status.success() {
        return Err(AppError::other(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into())
}
