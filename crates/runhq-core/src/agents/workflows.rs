//! Durable, explicitly advanced implementation → independent review → checks → apply.
//! A finished provider turn never counts as recorded validation or user acceptance.
use super::*;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

const OUTPUT_LIMIT: usize = 128 * 1024;
const PATCH_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowCheck {
    pub command: String,
    pub cwd: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub output: String,
    pub fingerprint: String,
    pub status: String,
}
/// One agent's part of a workflow.
///
/// A workflow used to be exactly two roles with their settings spread across the workflow itself: an
/// implementation session, plus a review session with its own backend and model. The step list makes
/// that shape explicit and extensible — each step names the role it plays, the account or pool that
/// runs it, the settings to run it with, and which earlier step's result it takes as input.
///
/// `target` may be a connection id or a `pool:` target, because an account is only chosen when the
/// step actually starts; recording the pool keeps the choice explainable after the fact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    /// One of `plan`, `implement`, `review`, `revise`, `validate`.
    pub role: String,
    pub target: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub mode: String,
    /// The session that ran this step, once one exists.
    #[serde(default)]
    pub session_id: Option<String>,
    /// The step whose revision this one starts from. `None` means the workflow's own base.
    #[serde(default)]
    pub input_step_id: Option<String>,
    /// `pending`, `running`, `completed` or `failed`.
    #[serde(default = "pending_status")]
    pub status: String,
    /// The workspace revision this step actually started from, recorded when it starts. A step's
    /// declared input says which step it follows; this says what that came to in practice.
    #[serde(default)]
    pub input_revision: Option<String>,
}

fn pending_status() -> String {
    "pending".into()
}

/// Turn a declared list into the workflow's steps, chaining each one to the step before it. The
/// first producing step is the session the workflow was created with; the rest open theirs when
/// they run, because a session belongs to the account that started it.
fn workflow_declared_steps(
    declared: &[CreateWorkflowStep],
    implementation_session_id: &str,
    base_revision: &str,
) -> Vec<WorkflowStep> {
    let mut steps = Vec::new();
    let mut previous: Option<String> = None;
    for (index, step) in declared.iter().enumerate() {
        let id = format!("{}-{}", step.role, index + 1);
        steps.push(WorkflowStep {
            id: id.clone(),
            role: step.role.clone(),
            target: step.target.clone(),
            model: step.model.clone(),
            effort: step.effort.clone(),
            mode: step.mode.clone(),
            session_id: if index == 0 {
                Some(implementation_session_id.to_string())
            } else {
                None
            },
            input_step_id: previous.clone(),
            status: "pending".into(),
            input_revision: if index == 0 {
                Some(base_revision.to_string())
            } else {
                None
            },
        });
        previous = Some(id);
    }
    steps
}

/// Title and instruction wording per role, so a step reads as itself rather than as "implement".
fn workflow_role_title(role: &str) -> &'static str {
    match role {
        "plan" => "Plan",
        "review" => "Review",
        "revise" => "Revision",
        "validate" => "Validation",
        _ => "Implementation",
    }
}
fn workflow_role_instruction(role: &str) -> &'static str {
    match role {
        "plan" => "produce a plan for the work",
        "revise" => "revise the existing work",
        _ => "implement",
    }
}

/// Roles that change the checkout. The rest read it and report, and run read-only.
pub fn workflow_role_produces(role: &str) -> bool {
    matches!(role, "plan" | "implement" | "revise")
}

/// The provider mode a producing step runs in.
///
/// A plan step asks for plan mode only where that mode is built into the integration. An ACP or
/// terminal connection advertises its modes once it is running, so asking for one it never
/// advertised fails the turn outright — the step runs in the connection's default mode instead and
/// the prompt carries the planning instruction.
fn workflow_step_mode(role: &str, adapter: &str) -> &'static str {
    if role == "plan" && matches!(adapter, "codex" | "claude" | "opencode") {
        "plan"
    } else {
        "default"
    }
}

pub const WORKFLOW_ROLES: [&str; 5] = ["plan", "implement", "review", "revise", "validate"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPreview {
    pub target: String,
    pub target_branch: String,
    pub target_fingerprint: String,
    pub source_fingerprint: String,
    pub patch: String,
    pub conflict: Option<String>,
}
/// Where reviewed work lands. The default keeps the previous behaviour — the patch is applied to the
/// destination working tree and left for the user to commit — while `branch` carries it onto a new
/// branch and commits it there. Pushing and opening a pull request stay outside RunHQ.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum WorkflowDestination {
    #[default]
    WorkingTree,
    Branch {
        branch: String,
        message: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowTransfer {
    pub path: String,
    pub source: String,
    pub size: u64,
    pub captured_at: i64,
    pub digest: String,
}
#[derive(Debug, Serialize)]
pub struct WorkflowWorktree {
    pub workflow_id: Option<String>,
    pub session_id: String,
    pub project_id: String,
    pub path: String,
    pub branch: Option<String>,
    pub base_revision: String,
    pub dirty: bool,
    pub status: String,
    pub active: bool,
    pub size_bytes: u64,
    pub size_incomplete: bool,
    pub missing: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkflow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub objective: String,
    pub acceptance: String,
    pub implementation_session_id: String,
    pub review_session_id: Option<String>,
    pub reviewer_backend: String,
    pub reviewer_model: String,
    /// The ordered roles this workflow runs. Empty on rows written before steps existed; those are
    /// migrated on read, so an older workflow reads as the two steps it always was.
    #[serde(default)]
    pub steps: Vec<WorkflowStep>,
    pub base_revision: String,
    pub cwd: String,
    pub root: String,
    pub target: String,
    pub stage: String,
    pub setup_commands: Vec<String>,
    pub check_commands: Vec<String>,
    pub setup: Vec<WorkflowCheck>,
    pub checks: Vec<WorkflowCheck>,
    pub review_fingerprint: Option<String>,
    pub current_fingerprint: Option<String>,
    pub preview: Option<WorkflowPreview>,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub cleaned: bool,
    #[serde(default)]
    pub auto_progress: bool,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub transferred_files: Vec<WorkflowTransfer>,
    /// Set when integration created a branch and commit, so the result names where the work went
    /// instead of only saying it was applied.
    #[serde(default)]
    pub integration_branch: Option<String>,
    #[serde(default)]
    pub integration_commit: Option<String>,
}
/// A step as the creating screen states it. The session, status and input revision are RunHQ's to
/// fill in as the workflow runs, so they are not accepted from the caller.
#[derive(Debug, Deserialize)]
pub struct CreateWorkflowStep {
    pub role: String,
    pub target: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub mode: String,
}
pub const MAX_WORKFLOW_STEPS: usize = 8;

#[derive(Debug, Deserialize)]
pub struct CreateAgentWorkflow {
    pub project_id: String,
    pub backend: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    pub reviewer_backend: String,
    #[serde(default)]
    pub reviewer_model: String,
    pub objective: String,
    #[serde(default)]
    pub acceptance: String,
    #[serde(default)]
    pub base_ref: String,
    #[serde(default)]
    pub setup_commands: Vec<String>,
    pub check_commands: Vec<String>,
    #[serde(default)]
    pub auto_progress: bool,
    /// The roles to run, in order. Empty keeps the two-role shape built from `backend` and
    /// `reviewer_backend`, so a caller that predates steps behaves exactly as before.
    #[serde(default)]
    pub steps: Vec<CreateWorkflowStep>,
}

// A short-held checkout lease also excludes ordinary agent starts. The long command
// runner owns it until its process tree has exited, even if a caller closes the view.
pub(super) struct WorkflowLease<'a> {
    manager: &'a AgentManager,
    key: String,
}
impl AgentWorkflow {
    /// The two roles a pre-step workflow always had, written out as steps.
    ///
    /// The implementation's connection lived only on its session, never on the workflow, so the
    /// migrated step names no target and points at the session that ran it instead of inventing one.
    /// The review's connection was stored on the workflow, so that step keeps it.
    pub(super) fn ensure_steps(&mut self) {
        if !self.steps.is_empty() {
            return;
        }
        self.steps = vec![
            WorkflowStep {
                id: "implement".into(),
                role: "implement".into(),
                target: String::new(),
                model: String::new(),
                effort: String::new(),
                mode: String::new(),
                session_id: Some(self.implementation_session_id.clone()),
                input_step_id: None,
                // A migrated workflow's progress is whatever its stage already said.
                status: if self.stage == "implementation_ready" {
                    "pending".into()
                } else if self.stage == "implementing" {
                    "running".into()
                } else if self.stage == "implementation_failed" {
                    "failed".into()
                } else {
                    "completed".into()
                },
                input_revision: Some(self.base_revision.clone()),
            },
            WorkflowStep {
                id: "review".into(),
                role: "review".into(),
                target: self.reviewer_backend.clone(),
                model: self.reviewer_model.clone(),
                effort: String::new(),
                mode: String::new(),
                session_id: self.review_session_id.clone(),
                input_step_id: Some("implement".into()),
                status: match self.stage.as_str() {
                    "reviewing" => "running".into(),
                    "review_failed" => "failed".into(),
                    _ if self.review_session_id.is_some() => "completed".into(),
                    _ => "pending".into(),
                },
                input_revision: self.review_fingerprint.clone(),
            },
        ];
    }
    pub fn step(&self, id: &str) -> Option<&WorkflowStep> {
        self.steps.iter().find(|step| step.id == id)
    }
    /// The step the workflow is on: the running one, else the first that has not completed. A failed
    /// step stays current, because retrying it is the explicit next action rather than skipping it.
    pub fn current_step(&self) -> Option<&WorkflowStep> {
        self.steps
            .iter()
            .find(|step| step.status == "running")
            .or_else(|| self.steps.iter().find(|step| step.status != "completed"))
    }
    fn current_step_mut(&mut self) -> Option<&mut WorkflowStep> {
        let id = self.current_step()?.id.clone();
        self.steps.iter_mut().find(|step| step.id == id)
    }
    /// The revision a step begins from: whatever its declared input actually produced, or the
    /// workflow's base when it follows nothing.
    pub fn step_input_revision(&self, step: &WorkflowStep) -> String {
        step.input_step_id
            .as_ref()
            .and_then(|id| self.step(id))
            .and_then(|input| input.input_revision.clone())
            .unwrap_or_else(|| self.base_revision.clone())
    }
}

impl Drop for WorkflowLease<'_> {
    fn drop(&mut self) {
        self.manager.state.lock().workflow_leases.remove(&self.key);
    }
}

impl AgentManager {
    fn workflow_rows(&self) -> AppResult<Vec<AgentWorkflow>> {
        let state = self.state.lock();
        let mut query = state
            .db
            .conn
            .prepare(
                "SELECT data FROM agent_workflows ORDER BY json_extract(data,'$.updated_at') DESC",
            )
            .map_err(|e| AppError::other(e.to_string()))?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| AppError::other(e.to_string()))?;
        rows.map(|row| {
            let mut workflow: AgentWorkflow =
                serde_json::from_str(&row.map_err(|e| AppError::other(e.to_string()))?)?;
            // Rows written before steps existed are read as the two roles they always had, so no
            // stored workflow has to be rewritten before it can be read.
            workflow.ensure_steps();
            Ok(workflow)
        })
        .collect()
    }
    fn workflow(&self, id: &str) -> AppResult<AgentWorkflow> {
        self.workflow_rows()?
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| invalid("Unknown agent workflow"))
    }
    fn save_workflow(&self, w: &mut AgentWorkflow) -> AppResult<()> {
        w.updated_at = now();
        self.state.lock().db.conn.execute("INSERT INTO agent_workflows(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![w.id, serde_json::to_string(w)?])
            .map_err(|e| AppError::other(e.to_string()))?;
        Ok(())
    }
    pub(super) fn recover_workflows(&self) -> AppResult<()> {
        for mut w in self.workflow_rows()? {
            if w.auto_progress && !matches!(w.stage.as_str(), "integrated" | "ready") {
                w.auto_progress = false;
                w.error = Some("Automatic progression paused after restart. Inspect the workspace and choose the next step explicitly.".into());
                self.save_workflow(&mut w)?;
            }
            if matches!(w.stage.as_str(), "setting_up" | "checking" | "integrating") {
                w.error = Some("RunHQ exited during this operation. Inspect the recorded output and workspace before explicitly retrying; nothing was replayed.".into());
                w.stage = "interrupted".into();
                for check in w.setup.iter_mut().chain(w.checks.iter_mut()) {
                    if check.status == "running" {
                        check.status = "interrupted".into();
                        check.finished_at = Some(now());
                    }
                }
                self.save_workflow(&mut w)?;
            }
        }
        Ok(())
    }
    pub(super) fn validate_workflow_turn(
        &self,
        session: &AgentSession,
        input: &AgentTurnInput,
    ) -> AppResult<()> {
        if session.workflow_read_only
            && (input.mode.as_deref().unwrap_or(&session.mode) != "plan"
                || !input.agent.as_deref().unwrap_or(&session.agent).is_empty())
        {
            return Err(invalid("Independent reviews stay in read-only plan mode"));
        }
        for w in self.workflow_rows()? {
            if w.review_session_id.as_deref() == Some(&session.id)
                && (input.mode.as_deref().unwrap_or(&session.mode) != "plan"
                    || !input.agent.as_deref().unwrap_or(&session.agent).is_empty())
            {
                return Err(invalid("Independent workflow reviews stay in read-only plan mode. Continue implementation in its original task."));
            }
            if (w.implementation_session_id == session.id
                || w.review_session_id.as_deref() == Some(&session.id))
                && (w.cleaned || w.stage == "integrated")
            {
                return Err(invalid("This workflow has been integrated or cleaned up. Create a new task for further changes."));
            }
        }
        Ok(())
    }
    pub(super) fn workflow_lease(&self, root: &Path) -> AppResult<WorkflowLease<'_>> {
        let root = root.canonicalize()?;
        let mut state = self.state.lock();
        let overlap = |path: &PathBuf| path.starts_with(&root) || root.starts_with(path);
        if state.running.values().any(|r| overlap(&r.cwd))
            || state.workflow_leases.values().any(overlap)
        {
            return Err(invalid(
                "An agent or workflow is using this checkout. Wait for it to finish.",
            ));
        }
        let key = uuid::Uuid::new_v4().to_string();
        state.workflow_leases.insert(key.clone(), root);
        Ok(WorkflowLease { manager: self, key })
    }
    async fn reconcile_workflow(&self, w: &mut AgentWorkflow) -> AppResult<()> {
        let old = serde_json::to_string(w)?;
        // A running step is finished by its session, not by a stage name. The stage then says what
        // the workflow as a whole is waiting for: another step, or validation once every step ran.
        if matches!(w.stage.as_str(), "implementing" | "reviewing") {
            let running = w
                .current_step()
                .filter(|step| step.status == "running")
                .cloned();
            if let Some(step) = running {
                let session = step.session_id.as_ref().map(|id| self.session(id));
                if let Some(session) = session.transpose()? {
                    if !session.active() {
                        let produced = workflow_role_produces(&step.role);
                        let completed = session.status == "completed";
                        if let Some(current) = w.current_step_mut() {
                            current.status = if completed { "completed" } else { "failed" }.into();
                        }
                        w.stage = match (completed, produced) {
                            (false, true) => "implementation_failed".into(),
                            (false, false) => "review_failed".into(),
                            // Every step having run is what makes validation the next thing to do.
                            (true, _) => {
                                if w.steps.iter().all(|step| step.status == "completed") {
                                    "checks_ready".into()
                                } else if workflow_role_produces(
                                    &w.current_step().map(|s| s.role.clone()).unwrap_or_default(),
                                ) {
                                    "implementation_ready".into()
                                } else {
                                    "review_ready".into()
                                }
                            }
                        };
                        w.error = session.last_error;
                    }
                }
            }
        }
        if !w.cleaned
            && matches!(
                w.stage.as_str(),
                "review_ready" | "checks_ready" | "checks_failed" | "ready"
            )
        {
            match self.workflow_fingerprint(Path::new(&w.root)).await {
                Ok(current) => {
                    w.current_fingerprint = Some(current.clone());
                    if matches!(w.stage.as_str(), "checks_ready" | "checks_failed" | "ready")
                        && w.review_fingerprint.as_ref() != Some(&current)
                    {
                        w.stage = "review_ready".into();
                        w.preview = None;
                        // The review that has been invalidated becomes the step to run again.
                        // Without this the workflow would have no current step and nothing could
                        // be started, leaving a changed workspace stuck short of validation.
                        if let Some(step) = w
                            .steps
                            .iter_mut()
                            .rev()
                            .find(|step| !workflow_role_produces(&step.role))
                        {
                            step.status = "pending".into();
                            step.input_revision = None;
                        }
                        w.error = Some("The workspace changed after review. Review this revision again before validation and integration.".into());
                    }
                }
                Err(error) => w.error = Some(error.to_string()),
            }
        }
        if serde_json::to_string(w)? != old {
            self.save_workflow(w)?;
        }
        Ok(())
    }
    pub async fn workflows(&self) -> AppResult<Vec<AgentWorkflow>> {
        // Do not let a status refresh overwrite an in-flight operation's durable record.
        let Ok(_gate) = self.workflow_gate.try_lock() else {
            return self.workflow_rows();
        };
        let mut rows = self.workflow_rows()?;
        for row in &mut rows {
            self.reconcile_workflow(row).await?;
        }
        Ok(rows)
    }
    pub async fn workflow_create(&self, input: CreateAgentWorkflow) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        if input.objective.trim().is_empty()
            || input.objective.len() > 128 * 1024
            || input.acceptance.len() > 64 * 1024
        {
            return Err(invalid(
                "Provide a task objective and bounded acceptance criteria",
            ));
        }
        validate_commands(&input.check_commands, true)?;
        validate_commands(&input.setup_commands, false)?;
        // A declared step list is checked before anything is created, so an unusable division of
        // labour is refused rather than half-built.
        if input.steps.len() > MAX_WORKFLOW_STEPS {
            return Err(invalid(format!(
                "A workflow runs at most {MAX_WORKFLOW_STEPS} steps"
            )));
        }
        for step in &input.steps {
            if !WORKFLOW_ROLES.contains(&step.role.as_str()) {
                return Err(invalid(format!("Unsupported workflow role: {}", step.role)));
            }
            if step.target.trim().is_empty() {
                return Err(invalid("Every step needs an account or pool to run it"));
            }
        }
        if !input.steps.is_empty() {
            if !workflow_role_produces(&input.steps[0].role) {
                return Err(invalid(
                    "The first step must produce work; a review has nothing to read before it",
                ));
            }
            if !input.steps.iter().any(|step| step.role == "review") {
                return Err(invalid(
                    "A workflow needs an independent review before its work can be integrated",
                ));
            }
        }
        // Reviewing roles need a real read-only mode, whichever step asks for one.
        let reviewer_targets: Vec<String> = if input.steps.is_empty() {
            vec![input.reviewer_backend.clone()]
        } else {
            input
                .steps
                .iter()
                .filter(|step| !workflow_role_produces(&step.role))
                .map(|step| step.target.clone())
                .collect()
        };
        for target in &reviewer_targets {
            // A pool is resolved when the step starts, so only a named connection can be checked
            // here; the pool's own members are checked as each one is chosen.
            if target.starts_with("pool:") {
                continue;
            }
            let review_tool = self.tool(target)?;
            if !matches!(review_tool.adapter.as_str(), "codex" | "claude") {
                return Err(invalid("Independent review requires Codex read-only sandbox or Claude plan mode. This provider does not expose a supported read-only review mode."));
            }
        }
        let project = self.state.lock().db.project(&input.project_id)?;
        let target = git_toplevel(Path::new(&project.path))
            .await?
            .to_string_lossy()
            .into_owned();
        let base_ref = if input.base_ref.trim().is_empty() {
            "HEAD"
        } else {
            input.base_ref.trim()
        };
        if base_ref.starts_with('-') || base_ref.len() > 256 {
            return Err(invalid("Invalid base branch or commit"));
        }
        let revision = git_output(
            Path::new(&target),
            &["rev-parse", "--verify", &format!("{base_ref}^{{commit}}")],
        )
        .await?
        .trim()
        .to_string();
        let title: String = input
            .objective
            .lines()
            .next()
            .unwrap_or("Agent workflow")
            .chars()
            .take(100)
            .collect();
        let session = self
            .create_at_base(
                CreateAgentSession {
                    creation_request_id: None,
                    project_id: input.project_id.clone(),
                    backend: input
                        .steps
                        .first()
                        .map(|step| step.target.clone())
                        .unwrap_or(input.backend),
                    executable: String::new(),
                    title: title.clone(),
                    model: input
                        .steps
                        .first()
                        .map(|step| step.model.clone())
                        .unwrap_or(input.model),
                    effort: input
                        .steps
                        .first()
                        .map(|step| step.effort.clone())
                        .unwrap_or(input.effort),
                    mode: "default".into(),
                    agent: String::new(),
                    isolated: true,
                },
                &revision,
            )
            .await?;
        let root = git_toplevel(Path::new(&session.cwd))
            .await?
            .to_string_lossy()
            .into_owned();
        let mut w = AgentWorkflow {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: input.project_id,
            title,
            objective: input.objective,
            acceptance: input.acceptance,
            implementation_session_id: session.id,
            review_session_id: None,
            reviewer_backend: input.reviewer_backend,
            reviewer_model: input.reviewer_model,
            // Filled from these fields right after construction, so creation keeps one description
            // of the two roles instead of two that can drift apart.
            steps: vec![],
            base_revision: revision,
            cwd: PathBuf::from(session.cwd)
                .canonicalize()?
                .to_string_lossy()
                .into(),
            root,
            target,
            stage: "implementation_ready".into(),
            setup_commands: input.setup_commands,
            check_commands: input.check_commands,
            setup: vec![],
            checks: vec![],
            review_fingerprint: None,
            current_fingerprint: None,
            preview: None,
            error: None,
            created_at: now(),
            updated_at: now(),
            cleaned: false,
            auto_progress: input.auto_progress,
            generation: 0,
            transferred_files: vec![],
            integration_branch: None,
            integration_commit: None,
        };
        w.steps =
            workflow_declared_steps(&input.steps, &w.implementation_session_id, &w.base_revision);
        w.ensure_steps();
        if !w.setup_commands.is_empty() {
            w.stage = "setup_ready".into();
        }
        self.save_workflow(&mut w)?;
        Ok(w)
    }
    /// Stages in which no step is running, so the next one may be started.
    fn workflow_idle(stage: &str) -> bool {
        matches!(
            stage,
            "implementation_ready"
                | "implementation_failed"
                | "review_failed"
                | "review_ready"
                | "checks_ready"
                | "checks_failed"
                | "ready"
                | "cancelled"
                | "interrupted"
        )
    }

    /// Run the step the workflow is on.
    ///
    /// The roles differ in what they are allowed to touch, not in how they are sequenced: a
    /// producing role works in the isolated checkout, a reviewing role reads it under a read-only
    /// session. Everything that protected the two fixed roles still applies — setup must have
    /// passed, a review needs a real change to look at, and the fingerprint a review saw is what
    /// validation and integration are later checked against.
    pub async fn workflow_run_step(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let w = self.workflow_run_step_inner(id).await?;
        // Automatic progression is started only from an explicit action. Keeping the spawn out of
        // the inner path also keeps the async call graph acyclic, which auto-trait inference needs.
        if w.auto_progress && w.stage == "implementing" {
            let manager = Arc::clone(self);
            let workflow_id = w.id.clone();
            let generation = w.generation;
            tokio::spawn(async move {
                manager.advance_workflow(workflow_id, generation).await;
            });
        }
        Ok(w)
    }

    async fn workflow_run_step_inner(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        if !Self::workflow_idle(&w.stage) || w.cleaned {
            return Err(invalid(
                "Finish setup or stop the current workflow step first",
            ));
        }
        let Some(step) = w.current_step().cloned() else {
            return Err(invalid("Every step in this workflow has completed"));
        };
        if workflow_role_produces(&step.role) {
            self.workflow_start_producing(&mut w, step).await
        } else {
            self.workflow_start_reviewing(&mut w, step).await
        }
    }

    /// Kept so an explicit "implement" action cannot silently start a review, and the other way
    /// round. Both run the step the workflow is on; they only disagree about what that may be.
    pub async fn workflow_implement(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let role = self
            .workflow(id)?
            .current_step()
            .map(|step| step.role.clone());
        match role {
            Some(role) if !workflow_role_produces(&role) => Err(invalid(
                "The next step in this workflow is a review, not implementation",
            )),
            _ => self.workflow_run_step(id).await,
        }
    }

    pub async fn workflow_review(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let role = self
            .workflow(id)?
            .current_step()
            .map(|step| step.role.clone());
        match role {
            Some(role) if workflow_role_produces(&role) => {
                Err(invalid("Finish implementation before independent review"))
            }
            _ => self.workflow_run_step(id).await,
        }
    }

    async fn workflow_start_producing(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        if !w.setup_commands.is_empty() && !commands_passed(&w.setup_commands, &w.setup) {
            return Err(invalid("Complete the setup commands before implementation"));
        }
        // The first producing step owns the session created with the workflow; a later one opens
        // its own in the same checkout, because a session belongs to the account that started it.
        let session = match &step.session_id {
            Some(id) => self.session(id)?,
            None => {
                let created = self
                    .create(CreateAgentSession {
                        creation_request_id: None,
                        project_id: w.project_id.clone(),
                        backend: step.target.clone(),
                        executable: String::new(),
                        title: format!("{} · {}", workflow_role_title(&step.role), w.title),
                        model: step.model.clone(),
                        effort: step.effort.clone(),
                        mode: if step.mode.is_empty() {
                            "default".into()
                        } else {
                            step.mode.clone()
                        },
                        agent: String::new(),
                        isolated: false,
                    })
                    .await?;
                let branch = self.session(&w.implementation_session_id)?.branch;
                self.mutate(&created.id, |s, _| {
                    s.cwd = w.cwd.clone();
                    s.isolated = true;
                    s.branch = branch.clone();
                    Ok(())
                })?
            }
        };
        let review_context = self.workflow_review_findings(w);
        let failed_checks = w
            .checks
            .iter()
            .filter(|check| check.status != "passed")
            .map(|check| {
                format!(
                    "{} (exit {:?}):\n{}",
                    check.command,
                    check.exit_code,
                    check.output.chars().take(8_000).collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let input_revision = w.step_input_revision(&step);
        w.review_fingerprint = None;
        w.preview = None;
        w.checks.clear();
        w.error = None;
        w.stage = "implementing".into();
        w.generation += 1;
        if let Some(current) = w.current_step_mut() {
            current.status = "running".into();
            current.session_id = Some(session.id.clone());
            current.input_revision = Some(input_revision.clone());
            if current.target.is_empty() {
                current.target = session.backend.clone();
            }
        }
        // The legacy field keeps naming the session that works in the checkout, so everything that
        // still reads it — recovery, fingerprints, the review's branch — keeps agreeing.
        w.implementation_session_id = session.id.clone();
        self.save_workflow(w)?;
        let prompt = format!(
            "{}\n\nAcceptance criteria:\n{}\n\nWorkflow: {} in this isolated checkout. Do not merge, push, or apply changes to the original project. An independent agent will review your changes against base {} and RunHQ will execute these checks: {}.\nSummarize the result and remaining risks.\n\nPrevious independent review (when revising, address its findings or explain why they do not apply):\n{}\n\nRecorded failed checks from the previous attempt:\n{}",
            w.objective,
            w.acceptance,
            workflow_role_instruction(&step.role),
            input_revision,
            w.check_commands.join("; "),
            review_context,
            failed_checks
        );
        if let Err(error) = self
            .start(AgentTurnInput {
                session_id: session.id,
                request_id: uuid::Uuid::new_v4().to_string(),
                prompt,
                model: session.model,
                effort: session.effort,
                mode: Some(workflow_step_mode(&step.role, &session.adapter).to_string()),
                agent: Some(String::new()),
                attachments: vec![],
            })
            .await
        {
            w.stage = "implementation_failed".into();
            w.error = Some(error.to_string());
            if let Some(current) = w.current_step_mut() {
                current.status = "failed".into();
            }
            self.save_workflow(w)?;
        }
        Ok(w.clone())
    }

    async fn workflow_start_reviewing(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        if self.session(&w.implementation_session_id)?.status != "completed" {
            return Err(invalid(
                "The implementation task must complete successfully before review",
            ));
        }
        let fingerprint = self.workflow_fingerprint(Path::new(&w.root)).await?;
        let patch = self.workflow_patch(w, &fingerprint).await?;
        if patch.is_empty() {
            return Err(invalid(
                "There are no changes to review against this workflow's base",
            ));
        }
        let reviewer = self
            .create(CreateAgentSession {
                creation_request_id: None,
                project_id: w.project_id.clone(),
                backend: if step.target.is_empty() {
                    w.reviewer_backend.clone()
                } else {
                    step.target.clone()
                },
                executable: String::new(),
                title: format!("{} · {}", workflow_role_title(&step.role), w.title),
                model: if step.model.is_empty() {
                    w.reviewer_model.clone()
                } else {
                    step.model.clone()
                },
                effort: step.effort.clone(),
                mode: "plan".into(),
                agent: String::new(),
                isolated: false,
            })
            .await?;
        // Separate provider session, same change baseline, no provider-native state transfer.
        let branch = self.session(&w.implementation_session_id)?.branch;
        let reviewer = self.mutate(&reviewer.id, |s, _| {
            s.cwd = w.cwd.clone();
            s.isolated = true;
            s.workflow_read_only = true;
            s.branch = branch.clone();
            Ok(())
        })?;
        w.review_session_id = Some(reviewer.id.clone());
        w.review_fingerprint = Some(fingerprint.clone());
        w.current_fingerprint = Some(fingerprint.clone());
        w.preview = None;
        w.checks.clear();
        w.stage = "reviewing".into();
        w.error = None;
        if let Some(current) = w.current_step_mut() {
            current.status = "running".into();
            current.session_id = Some(reviewer.id.clone());
            current.input_revision = Some(fingerprint.clone());
            if current.target.is_empty() {
                current.target = reviewer.backend.clone();
            }
        }
        self.save_workflow(w)?;
        let prompt = format!("Independently review this implementation. Read-only review: do not edit files, commit, switch branches, install dependencies, or request write permissions.\n\nObjective:\n{}\n\nAcceptance criteria:\n{}\n\nCompare the current checkout (including new files) against base commit {}. The captured complete workspace tree is {}. Inspect git diff {} and untracked files. Report concrete findings with severity and locations; state explicitly when you find no issues. Review findings will be shown to the user before they choose whether to apply changes.\n\nRequested validation commands:\n{}", w.objective, w.acceptance, w.base_revision, fingerprint, w.base_revision, w.check_commands.join("\n"));
        if let Err(error) = self
            .start(AgentTurnInput {
                session_id: reviewer.id,
                request_id: uuid::Uuid::new_v4().to_string(),
                prompt,
                model: reviewer.model,
                effort: reviewer.effort,
                mode: Some("plan".into()),
                agent: Some(String::new()),
                attachments: vec![],
            })
            .await
        {
            w.stage = "review_failed".into();
            w.error = Some(error.to_string());
            if let Some(current) = w.current_step_mut() {
                current.status = "failed".into();
            }
            self.save_workflow(w)?;
        }
        Ok(w.clone())
    }

    /// What earlier reviewing steps said, so a revision addresses findings instead of re-reading
    /// the diff blind. Empty when nothing has reviewed yet.
    fn workflow_review_findings(&self, w: &AgentWorkflow) -> String {
        let sessions: Vec<String> = w
            .steps
            .iter()
            .filter(|step| !workflow_role_produces(&step.role))
            .filter_map(|step| step.session_id.clone())
            .collect();
        sessions
            .iter()
            .filter_map(|id| self.snapshot(id, None).ok())
            .flat_map(|snapshot| {
                snapshot
                    .items
                    .into_iter()
                    .filter(|item| item.kind == "assistant")
                    .map(|item| item.text)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
            .chars()
            .take(24_000)
            .collect::<String>()
    }
    async fn workflow_fingerprint(&self, root: &Path) -> AppResult<String> {
        // A private index captures tracked + untracked non-ignored files and file modes,
        // without staging anything in the developer's real index or making a commit.
        let dir = self.home.join("workflow-indexes");
        std::fs::create_dir_all(&dir)?;
        let index = dir.join(uuid::Uuid::new_v4().to_string());
        let workflow = self
            .workflow_rows()?
            .into_iter()
            .find(|w| Path::new(&w.root) == root);
        let environment: Vec<PathBuf> = workflow
            .as_ref()
            .map(|w| {
                w.transferred_files
                    .iter()
                    .map(|file| Path::new(&w.cwd).join(&file.path))
                    .collect()
            })
            .unwrap_or_default();
        let excluded: Vec<String> = environment
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .map_err(|_| invalid("Invalid environment file location"))
            })
            .collect::<AppResult<_>>()?;
        let result: AppResult<String> = async {
            index_git(root, &index, &["read-tree", "HEAD"]).await?;
            let mut args: Vec<String> = ["add", "--all", "--", "."]
                .iter()
                .map(|s| s.to_string())
                .collect();
            for path in &excluded {
                index_git(
                    root,
                    &index,
                    &["update-index", "--force-remove", "--", path],
                )
                .await?;
                // Git treats a literal ignored pathspec as an error even when it
                // is an exclusion. Ignored paths need no exclusion after removal
                // from this private index; newly unignored paths do.
                if git_output(root, &["check-ignore", "--no-index", "--", path])
                    .await
                    .is_err()
                {
                    args.push(format!(":(exclude,literal){path}"));
                }
            }
            index_git(
                root,
                &index,
                &args.iter().map(String::as_str).collect::<Vec<_>>(),
            )
            .await?;
            for path in &excluded {
                index_git(
                    root,
                    &index,
                    &["update-index", "--force-remove", "--", path],
                )
                .await?;
            }
            Ok(index_git(root, &index, &["write-tree"])
                .await?
                .trim()
                .to_string())
        }
        .await;
        let _ = std::fs::remove_file(&index);
        let tree: String = result?;
        if environment.is_empty() {
            return Ok(tree);
        }
        let mut evidence = vec![];
        for path in environment {
            let digest = if path.exists() {
                let metadata = std::fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink()
                    || !metadata.is_file()
                    || metadata.len() > 1024 * 1024
                {
                    return Err(invalid(
                        "A transferred environment file changed type or exceeds 1 MiB",
                    ));
                }
                hash_bytes(root, &std::fs::read(&path)?).await?
            } else {
                "missing".into()
            };
            evidence.push((path.to_string_lossy().to_string(), digest));
        }
        Ok(format!(
            "{tree}:{}",
            hash_bytes(root, &serde_json::to_vec(&evidence)?).await?
        ))
    }
    async fn workflow_patch(&self, w: &AgentWorkflow, tree: &str) -> AppResult<String> {
        let tree = tree
            .split(':')
            .next()
            .ok_or_else(|| invalid("Invalid workspace fingerprint"))?;
        let patch = git_output(
            Path::new(&w.root),
            &[
                "diff",
                "--binary",
                "--no-ext-diff",
                &w.base_revision,
                tree,
                "--",
            ],
        )
        .await?;
        if patch.len() > PATCH_LIMIT {
            return Err(invalid("The change exceeds the 8 MiB integration preview limit; use the Git workspace to inspect and integrate it."));
        }
        Ok(patch)
    }
    pub async fn workflow_preview(&self, id: &str) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        self.require_validated(&w)?;
        let _source = self.workflow_lease(Path::new(&w.root))?;
        let _target = self.workflow_lease(Path::new(&w.target))?;
        let current = self.workflow_fingerprint(Path::new(&w.root)).await?;
        if w.review_fingerprint.as_ref() != Some(&current) {
            return Err(invalid(
                "The reviewed change is stale. Review and check it again.",
            ));
        }
        let patch = self.workflow_patch(&w, &current).await?;
        let status = git_output(Path::new(&w.target), &["status", "--porcelain"]).await?;
        let conflict = if !status.trim().is_empty() {
            Some("The destination contains local changes. Commit or preserve them before applying this workflow.".into())
        } else {
            apply_patch(Path::new(&w.target), &patch, true)
                .await
                .err()
                .map(|e| e.to_string())
        };
        w.preview = Some(WorkflowPreview {
            target: w.target.clone(),
            target_branch: git_output(Path::new(&w.target), &["rev-parse", "--abbrev-ref", "HEAD"])
                .await?
                .trim()
                .into(),
            target_fingerprint: git_output(Path::new(&w.target), &["rev-parse", "HEAD"])
                .await?
                .trim()
                .into(),
            source_fingerprint: current,
            patch,
            conflict,
        });
        self.save_workflow(&mut w)?;
        Ok(w)
    }
    fn require_validated(&self, w: &AgentWorkflow) -> AppResult<()> {
        if w.stage != "ready"
            || !commands_passed(&w.check_commands, &w.checks)
            || w.checks
                .iter()
                .any(|c| Some(&c.fingerprint) != w.review_fingerprint.as_ref())
        {
            return Err(invalid(
                "Complete independent review and all recorded checks for the same revision first",
            ));
        }
        let review = w
            .review_session_id
            .as_ref()
            .ok_or_else(|| invalid("Independent review is missing"))?;
        if self.session(review)?.status != "completed" {
            return Err(invalid("Independent review has not completed"));
        }
        Ok(())
    }
    pub async fn workflow_integrate(
        &self,
        id: &str,
        destination: WorkflowDestination,
    ) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        self.require_validated(&w)?;
        let preview = w
            .preview
            .clone()
            .ok_or_else(|| invalid("Preview the destination and change before applying"))?;
        if preview.conflict.is_some() {
            return Err(invalid(
                "Resolve the destination conflict and preview again",
            ));
        }
        let _source = self.workflow_lease(Path::new(&w.root))?;
        let _target = self.workflow_lease(Path::new(&w.target))?;
        if self.workflow_fingerprint(Path::new(&w.root)).await? != preview.source_fingerprint
            || git_output(Path::new(&w.target), &["rev-parse", "HEAD"])
                .await?
                .trim()
                != preview.target_fingerprint
            || !git_output(Path::new(&w.target), &["status", "--porcelain"])
                .await?
                .trim()
                .is_empty()
        {
            return Err(invalid(
                "The source or destination changed. Review the current integration preview again.",
            ));
        }
        // Recompute from Git objects, never trust a client-submitted patch or destination.
        let patch = self.workflow_patch(&w, &preview.source_fingerprint).await?;
        apply_patch(Path::new(&w.target), &patch, true).await?;
        if let WorkflowDestination::Branch { branch, message } = &destination {
            validate_branch_request(branch, message)?;
            if git_output(
                Path::new(&w.target),
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{branch}"),
                ],
            )
            .await
            .is_ok()
            {
                return Err(invalid(format!(
                    "Branch {branch} already exists in the destination"
                )));
            }
        }
        w.stage = "integrating".into();
        self.save_workflow(&mut w)?;
        let outcome = match &destination {
            WorkflowDestination::WorkingTree => apply_patch(Path::new(&w.target), &patch, false)
                .await
                .map(|_| (None, None)),
            WorkflowDestination::Branch { branch, message } => {
                self.integrate_on_branch(&w, &patch, branch, message).await
            }
        };
        match outcome {
            Ok((integration_branch, integration_commit)) => {
                w.stage = "integrated".into();
                w.integration_branch = integration_branch;
                w.integration_commit = integration_commit;
                w.error = None;
            }
            Err(error) => {
                w.stage = "integration_failed".into();
                w.error = Some(error.to_string());
            }
        }
        self.save_workflow(&mut w)?;
        Ok(w)
    }
    /// Apply the reviewed change onto a new branch and commit it there. The destination was
    /// verified clean, so a failure rolls back to the branch the user was on and removes the branch
    /// this created rather than leaving them somewhere they did not ask to be.
    async fn integrate_on_branch(
        &self,
        w: &AgentWorkflow,
        patch: &str,
        branch: &str,
        message: &str,
    ) -> AppResult<(Option<String>, Option<String>)> {
        let target = Path::new(&w.target);
        let original = git_output(target, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await?
            .trim()
            .to_string();
        git_output(target, &["checkout", "-b", branch]).await?;
        let carried = async {
            apply_patch(target, patch, false).await?;
            git_output(target, &["add", "--all"]).await?;
            git_output(
                target,
                &["-c", "commit.gpgsign=false", "commit", "--message", message],
            )
            .await?;
            Ok::<String, AppError>(
                git_output(target, &["rev-parse", "HEAD"])
                    .await?
                    .trim()
                    .to_string(),
            )
        }
        .await;
        match carried {
            Ok(commit) => Ok((Some(branch.to_string()), Some(commit))),
            Err(error) => {
                // Discard what this attempt wrote before returning; anything the patch added as an
                // untracked file is reported instead of being deleted silently.
                let restored = async {
                    git_output(target, &["reset", "--hard"]).await?;
                    git_output(target, &["checkout", "--force", &original]).await?;
                    git_output(target, &["branch", "-D", branch]).await
                }
                .await;
                Err(match restored {
                    Ok(_) => AppError::other(format!(
                        "{error}. The destination was restored to {original}; new files the patch added may remain untracked."
                    )),
                    Err(rollback) => AppError::other(format!(
                        "{error}. The destination could not be restored automatically ({rollback}); it may still be on {branch}."
                    )),
                })
            }
        }
    }
    pub async fn workflow_cleanup(&self, id: &str) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        if w.stage != "integrated" || w.cleaned {
            return Err(invalid(
                "Only an integrated workflow can remove its worktree",
            ));
        }
        let _lease = self.workflow_lease(Path::new(&w.root))?;
        let root = Path::new(&w.root).canonicalize()?;
        if self.sessions().iter().any(|session| {
            !session.archived
                && session.id != w.implementation_session_id
                && Some(&session.id) != w.review_session_id.as_ref()
                && session.status != "completed"
                && Path::new(&session.cwd)
                    .canonicalize()
                    .is_ok_and(|cwd| cwd.starts_with(&root) || root.starts_with(&cwd))
        }) {
            return Err(invalid("An unfinished linked task still uses this worktree. Complete or archive it before cleanup."));
        }
        if !root.starts_with(self.home.join("worktrees").canonicalize()?) {
            return Err(invalid("This is not a RunHQ-managed worktree"));
        }
        let current = self.workflow_fingerprint(&root).await?;
        if w.preview.as_ref().map(|p| &p.source_fingerprint) != Some(&current) {
            return Err(invalid(
                "The worktree has new changes since integration. Preserve them before cleanup.",
            ));
        }
        // Copies of selected config can be removed only while the original still
        // contains the same bytes. Unknown ignored files remain protected.
        let ignored = git_output(
            &root,
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "-z",
            ],
        )
        .await?;
        for path in ignored.split('\0').filter(|path| !path.is_empty()) {
            let copy = w
                .transferred_files
                .iter()
                .find(|copy| Path::new(&w.cwd).join(&copy.path) == root.join(path));
            let Some(copy) = copy else {
                return Err(invalid("The worktree contains ignored setup files (for example dependencies or local configuration). Remove or preserve them explicitly before cleanup."));
            };
            let source = Path::new(&copy.source);
            let metadata = std::fs::symlink_metadata(source).map_err(|_| {
                invalid("An original environment file is missing; retain its worktree copy")
            })?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > 1024 * 1024
                || hash_bytes(&root, &std::fs::read(source)?).await? != copy.digest
                || hash_bytes(&root, &std::fs::read(root.join(path))?).await? != copy.digest
            {
                return Err(invalid("An environment file changed after copying. Preserve its worktree copy before cleanup."));
            }
        }
        git_output(
            Path::new(&w.target),
            &["worktree", "remove", "--force", &w.root],
        )
        .await?;
        w.cleaned = true;
        self.save_workflow(&mut w)?;
        Ok(w)
    }
}

fn validate_commands(commands: &[String], required: bool) -> AppResult<()> {
    if (required && commands.is_empty())
        || commands.len() > 12
        || commands
            .iter()
            .any(|c| c.trim().is_empty() || c.len() > 8192 || c.contains('\0'))
    {
        return Err(invalid(
            "Provide 1–12 validation commands and at most 12 setup commands (one command per line)",
        ));
    }
    Ok(())
}
fn commands_passed(commands: &[String], evidence: &[WorkflowCheck]) -> bool {
    commands.len() == evidence.len()
        && commands.iter().zip(evidence).all(|(command, check)| {
            command == &check.command && check.status == "passed" && check.exit_code == Some(0)
        })
}
async fn index_git(root: &Path, index: &Path, args: &[&str]) -> AppResult<String> {
    let mut command = Command::new("git");
    command.args(args).kill_on_drop(true);
    crate::git::configure_git_cmd(command.as_std_mut(), root);
    command.env("GIT_INDEX_FILE", index);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| invalid("Workspace snapshot timed out"))??;
    if !output.status.success() {
        return Err(AppError::other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into())
}
async fn apply_patch(root: &Path, patch: &str, check: bool) -> AppResult<()> {
    let mut command = Command::new("git");
    command.args(["apply", "--binary", "--whitespace=nowarn"]);
    if check {
        command.arg("--check");
    }
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    crate::git::configure_git_cmd(command.as_std_mut(), root);
    command.stdin(std::process::Stdio::piped());
    let mut child = command.spawn()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("Missing Git input"))?;
    stdin.write_all(patch.as_bytes()).await?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .map_err(|_| {
            invalid("Patch application timed out; inspect the destination before retrying")
        })??;
    if !output.status.success() {
        return Err(AppError::other(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    Ok(())
}

struct CancellationRegistration<'a> {
    manager: &'a AgentManager,
    id: String,
}
impl Drop for CancellationRegistration<'_> {
    fn drop(&mut self) {
        self.manager.workflow_cancellations.lock().remove(&self.id);
    }
}
impl AgentManager {
    pub async fn workflow_commands(&self, id: &str, setup: bool) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        if w.cleaned
            || matches!(
                w.stage.as_str(),
                "integrated" | "integrating" | "implementing" | "reviewing"
            )
        {
            return Err(invalid(
                "Stop the active task before running workflow commands",
            ));
        }
        if setup {
            if w.setup_commands.is_empty() {
                return Err(invalid("This workflow has no setup commands"));
            }
            if !matches!(
                w.stage.as_str(),
                "setup_ready" | "setup_failed" | "interrupted" | "cancelled"
            ) {
                return Err(invalid("Setup runs before implementation"));
            }
        } else if !matches!(
            w.stage.as_str(),
            "checks_ready" | "checks_failed" | "ready" | "interrupted" | "cancelled"
        ) || w.review_fingerprint.is_none()
        {
            return Err(invalid(
                "Finish the independent review before running checks",
            ));
        }
        let _lease = self.workflow_lease(Path::new(&w.root))?;
        let fingerprint = self.workflow_fingerprint(Path::new(&w.root)).await?;
        if !setup && w.review_fingerprint.as_ref() != Some(&fingerprint) {
            return Err(invalid(
                "Changes since review require a new independent review",
            ));
        }
        let cancellation = CancellationToken::new();
        self.workflow_cancellations
            .lock()
            .insert(id.into(), cancellation.clone());
        let _registration = CancellationRegistration {
            manager: self,
            id: id.into(),
        };
        let commands = if setup {
            w.setup.clear();
            w.setup_commands.clone()
        } else {
            w.checks.clear();
            w.check_commands.clone()
        };
        w.stage = if setup { "setting_up" } else { "checking" }.into();
        w.preview = None;
        w.error = None;
        self.save_workflow(&mut w)?;
        // The persisted running stage plus checkout lease protect this workflow.
        // Other isolated workflows remain usable while a long check is running.
        drop(_gate);
        let mut failed = false;
        for command in commands {
            let evidence = WorkflowCheck {
                command: command.clone(),
                cwd: w.cwd.clone(),
                started_at: now(),
                finished_at: None,
                exit_code: None,
                output: String::new(),
                fingerprint: fingerprint.clone(),
                status: "running".into(),
            };
            if setup {
                w.setup.push(evidence);
            } else {
                w.checks.push(evidence);
            }
            self.save_workflow(&mut w)?;
            let result = run_workflow_command(&w.cwd, &command, cancellation.clone()).await;
            let evidence = if setup {
                w.setup.last_mut()
            } else {
                w.checks.last_mut()
            }
            .ok_or_else(|| invalid("Missing command evidence"))?;
            evidence.finished_at = Some(now());
            match result {
                Ok((exit, output, status)) => {
                    evidence.exit_code = exit;
                    evidence.output = output;
                    evidence.status = status;
                }
                Err(error) => {
                    evidence.status = "failed".into();
                    evidence.output = error.to_string();
                }
            }
            failed = evidence.status != "passed";
            self.save_workflow(&mut w)?;
            if failed || cancellation.is_cancelled() {
                break;
            }
        }
        let current = self.workflow_fingerprint(Path::new(&w.root)).await;
        if !setup && current.as_ref().ok() != Some(&fingerprint) {
            failed = true;
            w.error = Some(
                "Files changed during validation. Review the current revision and rerun checks."
                    .into(),
            );
            w.stage = "review_ready".into();
        } else if cancellation.is_cancelled() {
            w.stage = "cancelled".into();
        } else {
            w.stage = match (setup, failed) {
                (true, false) => "implementation_ready",
                (true, true) => "setup_failed",
                (false, false) => "ready",
                (false, true) => "checks_failed",
            }
            .into();
        }
        w.current_fingerprint = current.ok();
        if failed && w.error.is_none() {
            w.error = Some(
                "A recorded command failed or was interrupted. Inspect its output before retrying."
                    .into(),
            );
        }
        self.save_workflow(&mut w)?;
        Ok(w)
    }
    pub async fn workflow_cancel(&self, id: &str) -> AppResult<AgentWorkflow> {
        if let Some(token) = self.workflow_cancellations.lock().get(id).cloned() {
            token.cancel();
            return self.workflow(id);
        }
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        if matches!(w.stage.as_str(), "integrated" | "integrating") {
            return Err(invalid("This workflow has already been applied"));
        }
        // Every step that opened a session, not just the two the workflow used to have.
        let sessions: Vec<String> = w
            .steps
            .iter()
            .filter_map(|step| step.session_id.clone())
            .chain([w.implementation_session_id.clone()])
            .chain(w.review_session_id.clone())
            .collect();
        for session_id in sessions {
            if self.session(&session_id)?.active() {
                self.interrupt(&session_id).await?;
            }
        }
        // A stopped step is not still running, so it offers a retry rather than looking live.
        if let Some(step) = w.current_step_mut() {
            if step.status == "running" {
                step.status = "failed".into();
            }
        }
        w.stage = "cancelled".into();
        w.error = Some("Stopped by you. Workspace and evidence were retained; choose the next step explicitly.".into());
        self.save_workflow(&mut w)?;
        Ok(w)
    }
}
async fn run_workflow_command(
    cwd: &str,
    text: &str,
    cancellation: CancellationToken,
) -> AppResult<(Option<i32>, String, String)> {
    #[cfg(unix)]
    let mut command = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", &format!("({text}\n) 2>&1")]);
        c
    };
    #[cfg(windows)]
    let mut command = {
        let mut c = Command::new("cmd.exe");
        c.args(["/D", "/S", "/C", &format!("({text}) 2>&1")]);
        c
    };
    command.current_dir(cwd);
    let mut process = OwnedProcess::spawn(command)?;
    drop(process.child.stdin.take());
    let mut stdout = process
        .child
        .stdout
        .take()
        .ok_or_else(|| invalid("Missing command output"))?;
    let reader = tokio::spawn(async move {
        let mut buffer = [0_u8; 8192];
        let mut bytes = Vec::new();
        let mut truncated = false;
        loop {
            let count = stdout.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            let keep = count.min(OUTPUT_LIMIT.saturating_sub(bytes.len()));
            bytes.extend_from_slice(&buffer[..keep]);
            truncated |= keep < count;
        }
        let mut output = String::from_utf8_lossy(&bytes).to_string();
        if truncated {
            output.push_str("\n[Output truncated after 128 KiB]");
        }
        Ok::<_, std::io::Error>(output)
    });
    let (exit, status) = tokio::select! {
        result = process.child.wait() => { let exit = result?; (exit.code(), if exit.success() { "passed" } else { "failed" }) }
        _ = cancellation.cancelled() => { process.stop(); let exit = process.child.wait().await?; (exit.code(), "cancelled") }
        _ = tokio::time::sleep(Duration::from_secs(600)) => { process.stop(); let exit = process.child.wait().await?; (exit.code(), "timed_out") }
    };
    // A check is a bounded process, not a background service; kill surviving descendants.
    process.stop();
    let output = reader.await.map_err(|e| AppError::other(e.to_string()))??;
    Ok((exit, output, status.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn repository() -> (tempfile::TempDir, Arc<AgentManager>, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("project");
        std::fs::create_dir(&repo).unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&repo)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init"]);
        git(&["config", "user.email", "test@example.test"]);
        git(&["config", "user.name", "Test"]);
        // Keep fixture content byte-identical on every platform. Without this, Git on Windows
        // checks files back out with CRLF and the assertions would be testing the runner's line
        // endings rather than the behaviour under test.
        git(&["config", "core.autocrlf", "false"]);
        std::fs::write(repo.join("README.md"), "initial\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-m", "initial"]);
        let manager = Arc::new(
            AgentManager::open(
                &temp.path().join("state"),
                temp.path().join("bridge.cjs"),
                Arc::new(|_| {}),
            )
            .unwrap(),
        );
        (temp, manager, repo)
    }
    #[tokio::test]
    async fn snapshot_includes_untracked_and_staged_without_changing_the_real_index() {
        let (_temp, manager, repo) = repository();
        let before = manager.workflow_fingerprint(&repo).await.unwrap();
        std::fs::write(repo.join("new.txt"), "untracked\n").unwrap();
        std::fs::write(repo.join("README.md"), "updated\n").unwrap();
        let status = git_output(&repo, &["status", "--porcelain"]).await.unwrap();
        let after = manager.workflow_fingerprint(&repo).await.unwrap();
        assert_ne!(before, after);
        assert_eq!(
            status,
            git_output(&repo, &["status", "--porcelain"]).await.unwrap()
        );
        let diff = git_output(&repo, &["diff", &before, &after]).await.unwrap();
        assert!(diff.contains("new.txt"));
        assert!(diff.contains("updated"));
    }
    #[tokio::test]
    async fn checkout_lease_excludes_other_workflow_operations_and_releases_on_drop() {
        let (_temp, manager, repo) = repository();
        let lease = manager.workflow_lease(&repo).unwrap();
        assert!(manager.workflow_lease(&repo).is_err());
        drop(lease);
        assert!(manager.workflow_lease(&repo).is_ok());
    }
    #[tokio::test]
    async fn apply_preview_detects_conflicts_without_mutation() {
        let (_temp, manager, repo) = repository();
        let baseline = manager.workflow_fingerprint(&repo).await.unwrap();
        std::fs::write(repo.join("README.md"), "updated\n").unwrap();
        let next = manager.workflow_fingerprint(&repo).await.unwrap();
        let patch = git_output(&repo, &["diff", "--binary", &baseline, &next])
            .await
            .unwrap();
        assert!(apply_patch(&repo, &patch, true).await.is_err());
        std::fs::write(repo.join("README.md"), "initial\n").unwrap();
        apply_patch(&repo, &patch, true).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("README.md")).unwrap(),
            "initial\n"
        );
        apply_patch(&repo, &patch, false).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("README.md")).unwrap(),
            "updated\n"
        );
    }
    #[tokio::test]
    #[cfg(unix)]
    async fn command_evidence_records_real_failure_stdout_stderr_and_cancellation() {
        let temp = tempfile::tempdir().unwrap();
        let (exit, output, status) = run_workflow_command(
            temp.path().to_str().unwrap(),
            "printf 'out'; printf 'err' >&2; exit 7",
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(exit, Some(7));
        assert!(output.contains("out"));
        assert!(output.contains("err"));
        assert_eq!(status, "failed");
        let token = CancellationToken::new();
        token.cancel();
        let (_, _, status) = run_workflow_command(temp.path().to_str().unwrap(), "sleep 60", token)
            .await
            .unwrap();
        assert_eq!(status, "cancelled");
    }
    #[test]
    fn a_workflow_written_before_steps_reads_as_the_two_roles_it_always_had() {
        // The stored shape, without a `steps` field at all.
        let stored = json!({
            "id": "w1", "project_id": "p", "title": "t", "objective": "o", "acceptance": "a",
            "implementation_session_id": "impl-session",
            "review_session_id": "review-session",
            "reviewer_backend": "claude", "reviewer_model": "sonnet",
            "base_revision": "abc", "cwd": "/w", "root": "/w", "target": "/p",
            "stage": "ready", "setup_commands": [], "check_commands": [],
            "setup": [], "checks": [], "review_fingerprint": null,
            "current_fingerprint": null, "preview": null, "error": null,
            "created_at": 1, "updated_at": 2, "cleaned": false
        });
        let mut workflow: AgentWorkflow = serde_json::from_value(stored).unwrap();
        assert!(workflow.steps.is_empty(), "nothing was stored to read");
        workflow.ensure_steps();
        let roles: Vec<_> = workflow.steps.iter().map(|s| s.role.as_str()).collect();
        assert_eq!(roles, ["implement", "review"]);
        let implement = workflow.step("implement").unwrap();
        // The implementation's connection only ever lived on its session, so none is invented here.
        assert_eq!(implement.target, "");
        assert_eq!(implement.session_id.as_deref(), Some("impl-session"));
        assert_eq!(implement.input_step_id, None);
        let review = workflow.step("review").unwrap();
        assert_eq!(review.target, "claude");
        assert_eq!(review.model, "sonnet");
        assert_eq!(review.session_id.as_deref(), Some("review-session"));
        assert_eq!(review.input_step_id.as_deref(), Some("implement"));
        // Reading again must not rebuild steps over whatever the workflow has since recorded.
        workflow.steps[0].session_id = Some("replaced".into());
        workflow.ensure_steps();
        assert_eq!(
            workflow.step("implement").unwrap().session_id.as_deref(),
            Some("replaced")
        );
    }

    #[test]
    fn a_plan_step_asks_for_plan_mode_only_where_the_integration_has_one() {
        // Built-in plan modes: asking for one is safe and is what the role means.
        for adapter in ["codex", "claude", "opencode"] {
            assert_eq!(workflow_step_mode("plan", adapter), "plan");
        }
        // An ACP or terminal connection advertises its modes once it is running. Asking for a mode
        // it never advertised fails the turn outright — observed as "The selected mode is not
        // advertised by this ACP agent" — so the step runs in the connection's default instead.
        for adapter in ["acp", "terminal", ""] {
            assert_eq!(workflow_step_mode("plan", adapter), "default");
        }
        // Every other producing role works in the default mode whatever the connection is.
        for role in ["implement", "revise"] {
            for adapter in ["codex", "acp"] {
                assert_eq!(workflow_step_mode(role, adapter), "default");
            }
        }
    }

    #[test]
    fn check_success_requires_matching_commands_and_successful_exits() {
        let commands = vec!["test-command".into()];
        assert!(!commands_passed(&commands, &[]));
        let mut check = WorkflowCheck {
            command: "test-command".into(),
            cwd: "/example".into(),
            started_at: 1,
            finished_at: Some(2),
            exit_code: Some(1),
            output: "tests passed (agent claim)".into(),
            fingerprint: "tree".into(),
            status: "passed".into(),
        };
        assert!(!commands_passed(&commands, &[check.clone()]));
        check.exit_code = Some(0);
        assert!(commands_passed(&commands, &[check]));
    }
}

impl AgentManager {
    async fn advance_workflow(self: Arc<Self>, id: String, generation: u64) {
        // Only this live, explicitly started implementation can advance. On restart
        // recover_workflows pauses automation instead of replaying an uncertain step.
        let mut reviewed = false;
        let mut checked = false;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let state = {
                let _gate = self.workflow_gate.lock().await;
                match self.workflow(&id) {
                    Ok(mut workflow)
                        if workflow.auto_progress && workflow.generation == generation =>
                    {
                        if let Err(error) = self.reconcile_workflow(&mut workflow).await {
                            tracing::warn!("Workflow status refresh failed: {error}");
                            return;
                        }
                        workflow.stage
                    }
                    _ => return,
                }
            };
            let outcome = match state.as_str() {
                "implementing" | "reviewing" | "checking" => continue,
                "review_ready" if !reviewed => {
                    reviewed = true;
                    self.workflow_run_step_inner(&id).await
                }
                "checks_ready" if !checked => {
                    checked = true;
                    self.workflow_commands(&id, false).await
                }
                _ => return,
            };
            if let Err(error) = outcome {
                if let Ok(mut workflow) = self.workflow(&id) {
                    workflow.auto_progress = false;
                    workflow.error = Some(format!("Automatic progression paused: {error}"));
                    let _ = self.save_workflow(&mut workflow);
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    /// A real three-role workflow against installed provider CLIs.
    ///
    /// Ignored: it needs authenticated CLIs and network, so it is run by hand rather than in CI.
    /// `RUNHQ_E2E_PLAN`, `_IMPLEMENT` and `_REVIEW` name the connections to use.
    #[tokio::test]
    #[ignore = "requires authenticated provider CLIs"]
    async fn three_roles_run_on_real_providers() {
        // Same fixture repository, but a manager wired to the real agent runtime rather than the
        // placeholder path the unit tests use, so turns actually reach the provider CLIs.
        let (_temp, placeholder, repo) = super::tests::repository();
        let home = Path::new(&placeholder.home).join("e2e");
        drop(placeholder);
        let bridge = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/agent-runtime/bridge.mjs")
            .canonicalize()
            .expect("build the agent runtime first: pnpm agent:build");
        let manager = Arc::new(AgentManager::open(&home, bridge, Arc::new(|_| {})).unwrap());
        let project = manager.add_project("Example".into(), repo).unwrap();
        let named = |key: &str, fallback: &str| std::env::var(key).unwrap_or(fallback.into());
        let plan = named("RUNHQ_E2E_PLAN", "cursor");
        let implement = named("RUNHQ_E2E_IMPLEMENT", "cursor");
        let review = named("RUNHQ_E2E_REVIEW", "claude");
        let step = |role: &str, target: &str| CreateWorkflowStep {
            role: role.into(),
            target: target.into(),
            model: String::new(),
            effort: String::new(),
            mode: String::new(),
        };
        let workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id.clone(),
                backend: plan.clone(),
                model: String::new(),
                effort: String::new(),
                reviewer_backend: review.clone(),
                reviewer_model: String::new(),
                objective: "Add a file named STEPS.md containing exactly the word STEPS.".into(),
                acceptance: "STEPS.md exists and contains STEPS.".into(),
                base_ref: "HEAD".into(),
                setup_commands: vec![],
                check_commands: vec!["test -f STEPS.md".into()],
                auto_progress: false,
                steps: vec![
                    step("plan", &plan),
                    step("implement", &implement),
                    step("review", &review),
                ],
            })
            .await
            .unwrap();
        for expected in ["plan", "implement", "review"] {
            let before = manager.workflow(&workflow.id).unwrap();
            let current = before.current_step().unwrap();
            assert_eq!(
                current.role, expected,
                "steps run in the order declared; workflow error: {:?}",
                before.error
            );
            let step_id = current.id.clone();
            let mut answered = std::collections::HashSet::new();
            manager.workflow_run_step(&workflow.id).await.unwrap();
            // Wait for the provider to finish this step, answering the permission prompts a person
            // would answer, then let reconcile record the outcome.
            tokio::time::timeout(Duration::from_secs(420), async {
                loop {
                    let w = manager.workflows().await.unwrap();
                    let w = w.iter().find(|w| w.id == workflow.id).unwrap();
                    let step = w.step(&step_id).unwrap();
                    if step.status != "running" {
                        return step.status.clone();
                    }
                    if let Some(session_id) = &step.session_id {
                        if let Ok(session) = manager.session(session_id) {
                            for request in &session.pending {
                                let value = request.choices.as_array().and_then(|choices| {
                                    choices
                                        .iter()
                                        .find(|choice| {
                                            let label = choice["label"]
                                                .as_str()
                                                .unwrap_or_default()
                                                .to_lowercase();
                                            label.contains("allow") || label.contains("yes")
                                        })
                                        .map(|choice| choice["value"].clone())
                                });
                                let answer = value.unwrap_or(serde_json::json!("allow"));
                                // Answer each request once. Re-answering a request the provider
                                // rejected would spin without ever making progress, so the reason
                                // is printed instead of discarded.
                                if !answered.insert(request.id.clone()) {
                                    continue;
                                }
                                println!(
                                    "answering {:?} ({}) with {answer}; choices {}",
                                    request.title, request.kind, request.choices
                                );
                                if let Err(error) =
                                    manager.answer(session_id, &request.id, answer).await
                                {
                                    println!("  answer rejected: {error}");
                                }
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            })
            .await
            .map(|status: String| {
                let w = manager.workflow(&workflow.id).unwrap();
                let step = w.step(&step_id).unwrap();
                let session_error = step
                    .session_id
                    .as_ref()
                    .and_then(|id| manager.session(id).ok())
                    .and_then(|session| session.last_error);
                println!(
                    "step {step_id} on {} -> {status} (session {:?}, input {:?}, error {:?})",
                    step.target, step.session_id, step.input_revision, session_error
                );
            })
            .unwrap();
        }
        let done = manager.workflow(&workflow.id).unwrap();
        println!("stage {}", done.stage);
        for step in &done.steps {
            println!(
                "{} {} {} in {:?}",
                step.id, step.target, step.status, step.input_revision
            );
        }
    }

    #[tokio::test]
    async fn a_declared_division_of_labour_becomes_ordered_steps_with_their_own_accounts() {
        let (_temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Example".into(), repo).unwrap();
        for id in ["codex", "claude"] {
            let mut tool = manager.tool(id).unwrap();
            tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
            manager.save_tool(tool).unwrap();
        }
        let create = |steps: Vec<CreateWorkflowStep>| CreateAgentWorkflow {
            project_id: project.id.clone(),
            backend: "codex".into(),
            model: String::new(),
            effort: String::new(),
            reviewer_backend: "codex".into(),
            reviewer_model: String::new(),
            objective: "Make the requested change".into(),
            acceptance: String::new(),
            base_ref: "HEAD".into(),
            setup_commands: vec![],
            check_commands: vec!["echo verified".into()],
            auto_progress: false,
            steps,
        };
        let step = |role: &str, target: &str, model: &str| CreateWorkflowStep {
            role: role.into(),
            target: target.into(),
            model: model.into(),
            effort: String::new(),
            mode: String::new(),
        };
        let workflow = manager
            .workflow_create(create(vec![
                step("plan", "claude", "sonnet"),
                step("implement", "codex", ""),
                step("review", "claude", "opus"),
            ]))
            .await
            .unwrap();
        let shape: Vec<_> = workflow
            .steps
            .iter()
            .map(|s| {
                (
                    s.role.as_str(),
                    s.target.as_str(),
                    s.input_step_id.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                ("plan", "claude", None),
                ("implement", "codex", Some("plan-1")),
                ("review", "claude", Some("implement-2")),
            ],
            "each step names its own account and the step it follows"
        );
        // The first producing step is the session the workflow opened with, on its own account.
        assert_eq!(
            workflow.steps[0].session_id.as_deref(),
            Some(workflow.implementation_session_id.as_str())
        );
        let opening = manager
            .session(&workflow.implementation_session_id)
            .unwrap();
        assert_eq!(opening.backend, "claude");
        assert_eq!(opening.model, "sonnet");
        assert_eq!(workflow.current_step().unwrap().role, "plan");
        // A step that follows another starts from what that one produced, not from the base.
        assert_eq!(
            workflow.step_input_revision(workflow.step("implement-2").unwrap()),
            workflow.base_revision,
            "nothing has run yet, so the chain still resolves to the base"
        );

        // Shapes that cannot work are refused before anything is created.
        for (steps, expected) in [
            (vec![step("review", "codex", "")], "must produce work"),
            (
                vec![step("implement", "codex", ""), step("plan", "codex", "")],
                "needs an independent review",
            ),
            (vec![step("implement", "", "")], "needs an account or pool"),
            (
                vec![step("deploy", "codex", "")],
                "Unsupported workflow role",
            ),
        ] {
            let error = manager.workflow_create(create(steps)).await.unwrap_err();
            assert!(
                error.to_string().contains(expected),
                "expected {expected:?} in {error}"
            );
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn long_checks_allow_independent_workflow_creation_and_remain_cancellable() {
        let (_temp, manager, mut workflow) = prepared().await;
        workflow.check_commands = vec!["sleep 60".into()];
        manager.save_workflow(&mut workflow).unwrap();
        let background = Arc::clone(&manager);
        let id = workflow.id.clone();
        let task = tokio::spawn(async move { background.workflow_commands(&id, false).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            while manager.workflow(&workflow.id).unwrap().stage != "checking" {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let other = tokio::time::timeout(
            Duration::from_secs(5),
            manager.workflow_create(CreateAgentWorkflow {
                project_id: workflow.project_id.clone(),
                backend: "codex".into(),
                model: String::new(),
                effort: String::new(),
                reviewer_backend: "codex".into(),
                reviewer_model: String::new(),
                objective: "Independent task".into(),
                acceptance: String::new(),
                base_ref: "HEAD".into(),
                setup_commands: vec![],
                check_commands: vec!["echo verified".into()],
                auto_progress: false,
                steps: vec![],
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_ne!(other.root, workflow.root);
        manager.workflow_cancel(&workflow.id).await.unwrap();
        let ended = task.await.unwrap().unwrap();
        assert_eq!(ended.stage, "cancelled");
        assert_eq!(ended.checks[0].status, "cancelled");
    }
    #[tokio::test]
    async fn opted_in_automation_runs_one_distinct_review_and_checks_but_never_applies() {
        if super::super::executable("node").is_none() {
            return;
        }
        let (temp, manager, mut workflow) = prepared().await;
        std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'); const path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message=JSON.parse(line); if(message.type!=='start') return;
  const cfg=message.config;
  fs.appendFileSync(path.join(__dirname,'calls.jsonl'), JSON.stringify({cwd:cfg.cwd,mode:cfg.mode,review:cfg.read_only_review})+'\n');
  if(!cfg.read_only_review) fs.writeFileSync(path.join(cfg.cwd,'README.md'),'implemented by fixture\n');
  emit({type:'item',item:{id:'result',kind:'assistant',title:'Agent',text:cfg.read_only_review?'No review findings':'Implemented',status:'completed'}});
  setTimeout(()=>{emit({type:'finished',status:'completed'});process.exit(0);},30);
});
"#).unwrap();
        workflow.stage = "implementation_ready".into();
        workflow.auto_progress = true;
        manager.save_workflow(&mut workflow).unwrap();
        let started = manager.workflow_implement(&workflow.id).await.unwrap();
        assert_eq!(started.stage, "implementing");
        let ready = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let current = manager.workflow(&workflow.id).unwrap();
                if current.stage == "ready" {
                    break current;
                }
                assert!(!current.stage.ends_with("failed"), "{:?}", current.error);
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .unwrap();
        assert_ne!(
            ready.review_session_id.as_deref(),
            Some(ready.implementation_session_id.as_str())
        );
        assert_eq!(ready.checks[0].status, "passed");
        assert_eq!(
            std::fs::read_to_string(Path::new(&ready.target).join("README.md")).unwrap(),
            "initial\n"
        );
        let calls = std::fs::read_to_string(temp.path().join("calls.jsonl")).unwrap();
        let calls: Vec<Value> = calls
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            Path::new(calls[0]["cwd"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            Path::new(calls[1]["cwd"].as_str().unwrap())
                .canonicalize()
                .unwrap()
        );
        assert_eq!(calls[1]["mode"], "plan");
        assert_eq!(calls[1]["review"], true);
    }
    pub(super) async fn prepared() -> (tempfile::TempDir, Arc<AgentManager>, AgentWorkflow) {
        let (temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Example".into(), repo).unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        let mut workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id.clone(),
                backend: "codex".into(),
                model: String::new(),
                effort: String::new(),
                reviewer_backend: "codex".into(),
                reviewer_model: String::new(),
                objective: "Make the requested change".into(),
                acceptance: "The new file exists".into(),
                base_ref: "HEAD".into(),
                setup_commands: vec![],
                check_commands: vec!["echo verified".into()],
                auto_progress: false,
                steps: vec![],
            })
            .await
            .unwrap();
        std::fs::write(
            Path::new(&workflow.cwd).join("README.md"),
            "updated by implementation\n",
        )
        .unwrap();
        std::fs::write(Path::new(&workflow.cwd).join("new.txt"), "new file\n").unwrap();
        manager
            .mutate(&workflow.implementation_session_id, |s, _| {
                s.status = "completed".into();
                Ok(())
            })
            .unwrap();
        let reviewer = manager
            .create(CreateAgentSession {
                creation_request_id: None,
                project_id: project.id,
                backend: "codex".into(),
                executable: String::new(),
                title: "Independent review".into(),
                model: String::new(),
                effort: String::new(),
                mode: "plan".into(),
                agent: String::new(),
                isolated: false,
            })
            .await
            .unwrap();
        manager
            .mutate(&reviewer.id, |s, _| {
                s.cwd = workflow.cwd.clone();
                s.workflow_read_only = true;
                s.status = "completed".into();
                Ok(())
            })
            .unwrap();
        workflow.review_session_id = Some(reviewer.id);
        workflow.review_fingerprint = Some(
            manager
                .workflow_fingerprint(Path::new(&workflow.root))
                .await
                .unwrap(),
        );
        workflow.current_fingerprint = workflow.review_fingerprint.clone();
        workflow.stage = "checks_ready".into();
        manager.save_workflow(&mut workflow).unwrap();
        (temp, manager, workflow)
    }
    #[tokio::test]
    async fn a_new_workflow_describes_its_roles_as_steps_and_keeps_them_current() {
        let (_temp, manager, workflow) = prepared().await;
        // Creation writes the steps, so the list is never a migration artefact of old rows only.
        let roles: Vec<_> = workflow.steps.iter().map(|s| s.role.as_str()).collect();
        assert_eq!(roles, ["implement", "review"]);
        assert_eq!(
            workflow.step("implement").unwrap().session_id.as_deref(),
            Some(workflow.implementation_session_id.as_str())
        );
        assert_eq!(workflow.step("review").unwrap().target, "codex");
        // `prepared` assigns the reviewer directly, so reload through the store to see the row.
        let stored = manager.workflow(&workflow.id).unwrap();
        assert_eq!(
            stored.steps.len(),
            2,
            "reading does not duplicate the steps"
        );
        // Running a review records its session on the step as well as on the workflow.
        let mut running = stored;
        running.review_session_id = Some("reviewer-1".into());
        if let Some(step) = running.steps.iter_mut().find(|step| step.role == "review") {
            step.session_id = Some("reviewer-1".into());
        }
        manager.save_workflow(&mut running).unwrap();
        let reloaded = manager.workflow(&workflow.id).unwrap();
        assert_eq!(
            reloaded.step("review").unwrap().session_id.as_deref(),
            reloaded.review_session_id.as_deref(),
            "the step list and the legacy field describe the same review"
        );
    }

    #[tokio::test]
    async fn integrating_onto_a_branch_commits_there_and_leaves_the_original_branch_untouched() {
        let (_temp, manager, workflow) = prepared().await;
        let target = Path::new(&workflow.target).to_path_buf();
        let original = git_output(&target, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .unwrap()
            .trim()
            .to_string();
        manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        manager.workflow_preview(&workflow.id).await.unwrap();

        let branch = |name: &str| WorkflowDestination::Branch {
            branch: name.into(),
            message: "Apply reviewed change".into(),
        };
        // A name Git would refuse is reported in RunHQ's words before anything is touched.
        assert!(manager
            .workflow_integrate(&workflow.id, branch("bad name"))
            .await
            .is_err());
        assert_eq!(
            git_output(&target, &["rev-parse", "--abbrev-ref", "HEAD"])
                .await
                .unwrap()
                .trim(),
            original,
            "a rejected request does not move the destination"
        );

        let applied = manager
            .workflow_integrate(&workflow.id, branch("runhq/reviewed"))
            .await
            .unwrap();
        assert_eq!(applied.stage, "integrated");
        assert_eq!(
            applied.integration_branch.as_deref(),
            Some("runhq/reviewed")
        );
        let commit = applied.integration_commit.clone().unwrap();
        assert_ne!(commit, workflow.base_revision, "the work is committed");
        assert_eq!(
            git_output(&target, &["rev-parse", "runhq/reviewed"])
                .await
                .unwrap()
                .trim(),
            commit
        );
        assert_eq!(
            std::fs::read_to_string(target.join("new.txt")).unwrap(),
            "new file\n"
        );
        assert_eq!(
            git_output(&target, &["status", "--porcelain"])
                .await
                .unwrap()
                .trim(),
            "",
            "the commit leaves nothing uncommitted behind"
        );
        // The original branch still points at the revision the work started from.
        assert_eq!(
            git_output(&target, &["rev-parse", &original])
                .await
                .unwrap()
                .trim(),
            workflow.base_revision
        );
    }
    #[tokio::test]
    async fn reviewed_workflow_records_checks_previews_and_explicitly_applies_new_files() {
        let (_temp, manager, workflow) = prepared().await;
        let checked = manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        assert_eq!(checked.stage, "ready");
        assert_eq!(checked.checks[0].exit_code, Some(0));
        assert!(checked.checks[0].output.contains("verified"));
        assert_eq!(
            checked.checks[0].fingerprint,
            checked.review_fingerprint.clone().unwrap()
        );
        assert!(
            manager
                .workflow_integrate(&workflow.id, WorkflowDestination::WorkingTree)
                .await
                .is_err(),
            "preview is required"
        );
        let preview = manager.workflow_preview(&workflow.id).await.unwrap();
        assert!(preview.preview.as_ref().unwrap().patch.contains("new.txt"));
        assert!(
            !Path::new(&workflow.target).join("new.txt").exists(),
            "preview is read-only"
        );
        let applied = manager
            .workflow_integrate(&workflow.id, WorkflowDestination::WorkingTree)
            .await
            .unwrap();
        assert_eq!(applied.stage, "integrated");
        assert_eq!(
            std::fs::read_to_string(Path::new(&workflow.target).join("new.txt")).unwrap(),
            "new file\n"
        );
        assert_eq!(
            git_output(Path::new(&workflow.target), &["rev-parse", "HEAD"])
                .await
                .unwrap()
                .trim(),
            workflow.base_revision,
            "applying makes no commit"
        );
        assert!(
            manager
                .delete_session(&workflow.implementation_session_id)
                .is_err(),
            "workflow evidence must survive"
        );
        let cleaned = manager.workflow_cleanup(&workflow.id).await.unwrap();
        assert!(cleaned.cleaned);
        assert!(!Path::new(&workflow.root).exists());
    }
    #[tokio::test]
    async fn edited_source_invalidates_review_checks_and_integration_preview() {
        let (_temp, manager, workflow) = prepared().await;
        manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        manager.workflow_preview(&workflow.id).await.unwrap();
        std::fs::write(
            Path::new(&workflow.cwd).join("new.txt"),
            "changed after checking\n",
        )
        .unwrap();
        assert!(manager
            .workflow_integrate(&workflow.id, WorkflowDestination::WorkingTree)
            .await
            .is_err());
        let saved = manager.workflow(&workflow.id).unwrap();
        assert_eq!(saved.stage, "review_ready");
        assert!(saved.preview.is_none());
        assert!(!Path::new(&workflow.target).join("new.txt").exists());
    }
    #[tokio::test]
    async fn dirty_destination_is_reported_without_touching_local_changes() {
        let (_temp, manager, workflow) = prepared().await;
        manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        std::fs::write(
            Path::new(&workflow.target).join("local.txt"),
            "my local changes",
        )
        .unwrap();
        let preview = manager.workflow_preview(&workflow.id).await.unwrap();
        assert!(preview
            .preview
            .unwrap()
            .conflict
            .unwrap()
            .contains("local changes"));
        assert!(manager
            .workflow_integrate(&workflow.id, WorkflowDestination::WorkingTree)
            .await
            .is_err());
        assert_eq!(
            std::fs::read_to_string(Path::new(&workflow.target).join("local.txt")).unwrap(),
            "my local changes"
        );
    }
    #[tokio::test]
    async fn restart_retains_evidence_and_pauses_uncertain_operations_and_automation() {
        let (temp, manager, mut workflow) = prepared().await;
        workflow.stage = "checking".into();
        workflow.auto_progress = true;
        workflow.checks.push(WorkflowCheck {
            command: "echo must-not-replay".into(),
            cwd: workflow.cwd.clone(),
            started_at: now(),
            finished_at: None,
            exit_code: None,
            output: "partial output".into(),
            fingerprint: workflow.review_fingerprint.clone().unwrap(),
            status: "running".into(),
        });
        manager.save_workflow(&mut workflow).unwrap();
        drop(manager);
        let reopened = AgentManager::open(
            &temp.path().join("state"),
            temp.path().join("bridge.cjs"),
            Arc::new(|_| {}),
        )
        .unwrap();
        let saved = reopened.workflow(&workflow.id).unwrap();
        assert_eq!(saved.stage, "interrupted");
        assert!(!saved.auto_progress);
        assert_eq!(saved.checks[0].status, "interrupted");
        assert_eq!(saved.checks[0].output, "partial output");
        assert_eq!(saved.base_revision, workflow.base_revision);
    }
    #[tokio::test]
    async fn checks_that_change_the_workspace_do_not_count_as_verified() {
        let (_temp, manager, mut workflow) = prepared().await;
        workflow.check_commands = vec!["echo generated > generated.txt".into()];
        manager.save_workflow(&mut workflow).unwrap();
        let result = manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        assert_eq!(result.checks[0].exit_code, Some(0));
        assert_eq!(result.stage, "review_ready");
        assert!(manager.workflow_preview(&workflow.id).await.is_err());
    }
}

impl AgentManager {
    pub async fn workflow_transfer_files(
        &self,
        id: &str,
        paths: Vec<String>,
    ) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut workflow = self.workflow(id)?;
        if !matches!(
            workflow.stage.as_str(),
            "setup_ready" | "setup_failed" | "implementation_ready"
        ) || self.session(&workflow.implementation_session_id)?.status != "idle"
        {
            return Err(invalid(
                "Transfer selected environment files before implementation starts",
            ));
        }
        if paths.is_empty() || paths.len() > 20 {
            return Err(invalid(
                "Select 1–20 project-relative environment file paths",
            ));
        }
        let project = self.state.lock().db.project(&workflow.project_id)?;
        let source_root = Path::new(&project.path).canonicalize()?;
        let destination_root = Path::new(&workflow.cwd).canonicalize()?;
        let _lease = self.workflow_lease(Path::new(&workflow.root))?;
        let mut planned = vec![];
        for path in paths {
            let relative = safe_relative_file(&path)?;
            let source = source_root.join(&relative);
            let metadata = std::fs::symlink_metadata(&source)?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || metadata.len() > 1024 * 1024
                || !source.canonicalize()?.starts_with(&source_root)
            {
                return Err(invalid(format!(
                    "{path}: select a regular file inside this project, at most 1 MiB"
                )));
            }
            let destination = destination_root.join(&relative);
            ensure_transfer_destination(&destination_root, &relative)?;
            // Environment credentials must never enter the review patch. Require
            // ignore rules at the destination and explicitly exclude these paths
            // from every later private-index snapshot, even if ignore rules change.
            if git_output(&destination_root, &["check-ignore", "--", &path])
                .await
                .is_err()
            {
                return Err(invalid(format!("{path} is not ignored by Git in this worktree. Add an appropriate ignore rule before transferring environment configuration.")));
            }
            let data = std::fs::read(&source)?;
            if data.len() > 1024 * 1024 {
                return Err(invalid("Environment file grew beyond 1 MiB during capture"));
            }
            let digest = hash_bytes(Path::new(&workflow.root), &data).await?;
            planned.push((
                path,
                source,
                destination,
                metadata.permissions(),
                data,
                digest,
            ));
        }
        for (path, source, destination, permissions, data, digest) in planned {
            let parent = destination
                .parent()
                .ok_or_else(|| invalid("Invalid environment destination"))?;
            std::fs::create_dir_all(parent)?;
            ensure_transfer_destination(&destination_root, &safe_relative_file(&path)?)?;
            let temporary = parent.join(format!(".runhq-transfer-{}", uuid::Uuid::new_v4()));
            let write = (|| -> AppResult<()> {
                std::fs::write(&temporary, &data)?;
                std::fs::set_permissions(&temporary, permissions)?;
                std::fs::rename(&temporary, &destination)?;
                Ok(())
            })();
            let _ = std::fs::remove_file(&temporary);
            write?;
            workflow.transferred_files.retain(|file| file.path != path);
            workflow.transferred_files.push(WorkflowTransfer {
                path,
                source: source.to_string_lossy().into(),
                size: data.len() as u64,
                captured_at: now(),
                digest,
            });
            workflow
                .transferred_files
                .sort_by(|a, b| a.path.cmp(&b.path));
            // Metadata only: file contents and secrets never enter SQLite or logs.
            self.save_workflow(&mut workflow)?;
        }
        workflow.current_fingerprint =
            Some(self.workflow_fingerprint(Path::new(&workflow.root)).await?);
        self.save_workflow(&mut workflow)?;
        Ok(workflow)
    }
    pub async fn workflow_inventory(&self) -> AppResult<Vec<WorkflowWorktree>> {
        let mut inventory = vec![];
        let workflows = self.workflow_rows()?;
        let mut seen: std::collections::HashSet<PathBuf> =
            workflows.iter().map(|w| PathBuf::from(&w.root)).collect();
        for workflow in workflows.into_iter().filter(|w| !w.cleaned) {
            let root = PathBuf::from(&workflow.root);
            let missing = !root.is_dir();
            let status = if missing {
                "Worktree directory is missing".into()
            } else {
                git_output(&root, &["status", "--porcelain"])
                    .await
                    .unwrap_or_else(|e| e.to_string())
            };
            let active = {
                let state = self.state.lock();
                state
                    .running
                    .values()
                    .any(|r| r.cwd.starts_with(&root) || root.starts_with(&r.cwd))
                    || state
                        .workflow_leases
                        .values()
                        .any(|p| p.starts_with(&root) || root.starts_with(p))
            };
            let (size_bytes, size_incomplete) = if missing {
                (0, false)
            } else {
                tokio::task::spawn_blocking(move || directory_size(&root))
                    .await
                    .map_err(|e| AppError::other(e.to_string()))?
            };
            inventory.push(WorkflowWorktree {
                workflow_id: Some(workflow.id),
                session_id: workflow.implementation_session_id.clone(),
                project_id: workflow.project_id,
                path: workflow.root,
                branch: self
                    .session(&workflow.implementation_session_id)
                    .ok()
                    .and_then(|s| s.branch),
                base_revision: workflow.base_revision,
                dirty: !status.trim().is_empty(),
                status,
                active,
                size_bytes,
                size_incomplete,
                missing,
            });
        }
        for session in self.sessions().into_iter().filter(|s| s.isolated) {
            let cwd = PathBuf::from(&session.cwd);
            if !cwd.is_dir() {
                continue;
            }
            let Ok(root) = git_toplevel(&cwd).await else {
                continue;
            };
            let Ok(managed) = self.home.join("worktrees").canonicalize() else {
                continue;
            };
            if !root.starts_with(managed) || !seen.insert(root.clone()) {
                continue;
            }
            let status = git_output(&root, &["status", "--porcelain"])
                .await
                .unwrap_or_else(|e| e.to_string());
            let active = {
                let state = self.state.lock();
                state
                    .running
                    .values()
                    .any(|r| r.cwd.starts_with(&root) || root.starts_with(&r.cwd))
                    || state
                        .workflow_leases
                        .values()
                        .any(|p| p.starts_with(&root) || root.starts_with(p))
            };
            let scan_root = root.clone();
            let (size_bytes, size_incomplete) =
                tokio::task::spawn_blocking(move || directory_size(&scan_root))
                    .await
                    .map_err(|e| AppError::other(e.to_string()))?;
            inventory.push(WorkflowWorktree {
                workflow_id: None,
                session_id: session.id,
                project_id: session.project_id,
                path: root.to_string_lossy().into(),
                branch: session.branch,
                base_revision: "Not recorded for standalone task".into(),
                dirty: !status.trim().is_empty(),
                status,
                active,
                size_bytes,
                size_incomplete,
                missing: false,
            });
        }
        Ok(inventory)
    }
}
fn safe_relative_file(path: &str) -> AppResult<PathBuf> {
    let relative = PathBuf::from(path);
    if path.is_empty()
        || path.len() > 1024
        || path.contains('\\')
        || relative
            .components()
            .any(|p| !matches!(p, std::path::Component::Normal(name) if name != ".git"))
    {
        return Err(invalid(
            "Use a project-relative file path without '..', symlinks or Git metadata",
        ));
    }
    Ok(relative)
}
fn ensure_transfer_destination(root: &Path, relative: &Path) -> AppResult<()> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(invalid(
                    "Environment transfer cannot follow destination symlinks",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
async fn hash_bytes(root: &Path, bytes: &[u8]) -> AppResult<String> {
    let mut command = Command::new("git");
    crate::git::configure_git_cmd(command.as_std_mut(), root);
    command
        .args(["hash-object", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("Missing hash input"))?;
    stdin.write_all(bytes).await?;
    drop(stdin);
    let output = child.wait_with_output().await?;
    if !output.status.success() {
        return Err(invalid("Could not fingerprint environment configuration"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
fn directory_size(root: &Path) -> (u64, bool) {
    let mut pending = vec![root.to_path_buf()];
    let mut size: u64 = 0;
    let mut seen = 0;
    let mut incomplete = false;
    while let Some(path) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(path) else {
            incomplete = true;
            continue;
        };
        for entry in entries {
            seen += 1;
            if seen > 100_000 {
                return (size, true);
            }
            let Ok(entry) = entry else {
                incomplete = true;
                continue;
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                incomplete = true;
                continue;
            };
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                pending.push(entry.path());
            } else {
                size = size.saturating_add(metadata.len());
            }
        }
    }
    (size, incomplete)
}

#[cfg(test)]
mod environment_tests {
    use super::*;
    #[tokio::test]
    async fn selected_environment_is_copied_and_fingerprinted_but_never_enters_the_patch_or_database(
    ) {
        let (_temp, manager, mut workflow) = super::lifecycle_tests::prepared().await;
        manager
            .mutate(&workflow.implementation_session_id, |session, _| {
                session.status = "idle".into();
                Ok(())
            })
            .unwrap();
        workflow.stage = "implementation_ready".into();
        manager.save_workflow(&mut workflow).unwrap();
        std::fs::write(
            Path::new(&workflow.target).join(".git/info/exclude"),
            ".env.local\n",
        )
        .unwrap();
        std::fs::write(
            Path::new(&workflow.target).join(".env.local"),
            "secret=fixture-only-value\n",
        )
        .unwrap();
        let copied = manager
            .workflow_transfer_files(&workflow.id, vec![".env.local".into()])
            .await
            .unwrap();
        assert_eq!(copied.transferred_files.len(), 1);
        assert_eq!(
            std::fs::read_to_string(Path::new(&copied.cwd).join(".env.local")).unwrap(),
            "secret=fixture-only-value\n"
        );
        assert!(!serde_json::to_string(&copied)
            .unwrap()
            .contains("fixture-only-value"));
        assert!(
            git_output(
                Path::new(&workflow.root),
                &["cat-file", "-e", &copied.transferred_files[0].digest]
            )
            .await
            .is_err(),
            "environment bytes must not be stored as Git objects"
        );
        let fingerprint = copied.current_fingerprint.unwrap();
        assert!(fingerprint.contains(':'));
        let patch = manager
            .workflow_patch(&workflow, &fingerprint)
            .await
            .unwrap();
        assert!(!patch.contains(".env.local"));
        assert!(!patch.contains("fixture-only-value"));
        // Even force-staging config does not cause the private snapshot to include it.
        git_output(Path::new(&workflow.root), &["add", "-f", ".env.local"])
            .await
            .unwrap();
        let after_staging = manager
            .workflow_fingerprint(Path::new(&workflow.root))
            .await
            .unwrap();
        assert_eq!(fingerprint, after_staging);
        std::fs::write(Path::new(&workflow.target).join(".git/info/exclude"), "").unwrap();
        assert_eq!(
            fingerprint,
            manager
                .workflow_fingerprint(Path::new(&workflow.root))
                .await
                .unwrap(),
            "configuration remains excluded if ignore rules change"
        );
        std::fs::write(
            Path::new(&workflow.cwd).join(".env.local"),
            "secret=changed\n",
        )
        .unwrap();
        assert_ne!(
            fingerprint,
            manager
                .workflow_fingerprint(Path::new(&workflow.root))
                .await
                .unwrap()
        );
    }
    #[tokio::test]
    async fn environment_transfer_rejects_traversal_git_metadata_and_tracked_code_before_writing() {
        let (_temp, manager, mut workflow) = super::lifecycle_tests::prepared().await;
        manager
            .mutate(&workflow.implementation_session_id, |session, _| {
                session.status = "idle".into();
                Ok(())
            })
            .unwrap();
        workflow.stage = "implementation_ready".into();
        manager.save_workflow(&mut workflow).unwrap();
        for path in ["../outside", "/tmp/example", ".git/config", "README.md"] {
            assert!(
                manager
                    .workflow_transfer_files(&workflow.id, vec![path.into()])
                    .await
                    .is_err(),
                "{path}"
            );
        }
        assert!(manager
            .workflow(&workflow.id)
            .unwrap()
            .transferred_files
            .is_empty());
    }
    #[tokio::test]
    async fn inventory_reports_branch_changes_size_and_all_checkout_users() {
        let (_temp, manager, workflow) = super::lifecycle_tests::prepared().await;
        let _lease = manager.workflow_lease(Path::new(&workflow.root)).unwrap();
        let inventory = manager.workflow_inventory().await.unwrap();
        let entry = inventory
            .iter()
            .find(|entry| entry.workflow_id.as_deref() == Some(workflow.id.as_str()))
            .unwrap();
        assert!(entry.active);
        assert!(entry.dirty);
        assert!(entry.size_bytes > 0);
        assert!(entry.branch.as_ref().unwrap().starts_with("codex/runhq-"));
        assert!(entry.status.contains("new.txt"));
    }
}

#[cfg(test)]
mod handoff_tests {
    use super::*;
    fn input(workflow: &AgentWorkflow, id: &str) -> CreateAgentSession {
        CreateAgentSession {
            creation_request_id: Some(id.into()),
            project_id: workflow.project_id.clone(),
            backend: "codex".into(),
            executable: String::new(),
            title: "Handed-off task".into(),
            model: String::new(),
            effort: String::new(),
            mode: "default".into(),
            agent: String::new(),
            isolated: false,
        }
    }
    #[tokio::test]
    async fn retry_keeps_an_active_target_and_rejects_rebinding_its_creation_id_to_another_source()
    {
        let (_temp, manager, workflow) = super::lifecycle_tests::prepared().await;
        let id = uuid::Uuid::new_v4().to_string();
        let target = manager
            .handoff_create(&workflow.implementation_session_id, input(&workflow, &id))
            .await
            .unwrap();
        assert_eq!(target.cwd, workflow.cwd);
        assert!(target.isolated);
        assert!(target.native_id.is_none());
        let active = manager
            .mutate(&target.id, |session, _| {
                session.status = "running".into();
                Ok(())
            })
            .unwrap();
        manager
            .mutate(&workflow.implementation_session_id, |session, _| {
                session.status = "running".into();
                Ok(())
            })
            .unwrap();
        let retry = manager
            .handoff_create(&workflow.implementation_session_id, input(&workflow, &id))
            .await
            .unwrap();
        assert_eq!(retry.revision, active.revision);
        assert_eq!(retry.cwd, active.cwd);
        assert_eq!(retry.status, "running");
        let other_id = workflow.review_session_id.as_ref().unwrap();
        assert!(manager
            .handoff_create(other_id, input(&workflow, &id))
            .await
            .unwrap_err()
            .to_string()
            .contains("different source"));
        assert_eq!(manager.session(&id).unwrap().revision, active.revision);
    }
    #[tokio::test]
    async fn incomplete_handoff_cannot_start_and_recovers_the_same_target_after_restart() {
        let (temp, manager, workflow) = super::lifecycle_tests::prepared().await;
        let id = uuid::Uuid::new_v4().to_string();
        let target = manager
            .handoff_create(&workflow.implementation_session_id, input(&workflow, &id))
            .await
            .unwrap();
        manager.workspace_save(format!("link:{id}"), None).unwrap();
        manager
            .mutate(&target.id, |session, _| {
                session.cwd = workflow.target.clone();
                Ok(())
            })
            .unwrap();
        let failed = manager
            .start(AgentTurnInput {
                session_id: id.clone(),
                request_id: uuid::Uuid::new_v4().to_string(),
                prompt: "Should not start in the original checkout".into(),
                model: String::new(),
                effort: String::new(),
                mode: None,
                agent: None,
                attachments: vec![],
            })
            .await
            .unwrap_err();
        assert!(failed
            .to_string()
            .contains("handoff is still being prepared"));
        let count = manager.sessions().len();
        drop(manager);
        let reopened = Arc::new(
            AgentManager::open(
                &temp.path().join("state"),
                temp.path().join("bridge.cjs"),
                Arc::new(|_| {}),
            )
            .unwrap(),
        );
        let recovered = reopened
            .handoff_create(&workflow.implementation_session_id, input(&workflow, &id))
            .await
            .unwrap();
        assert_eq!(recovered.id, id);
        assert_eq!(recovered.cwd, workflow.cwd);
        assert_eq!(reopened.sessions().len(), count);
        assert_eq!(
            reopened
                .workspace_record(&format!("link:{id}"))
                .unwrap()
                .unwrap()
                .value["sourceSessionId"],
            workflow.implementation_session_id
        );
    }
    #[tokio::test]
    async fn unfinished_handoff_protects_a_shared_worktree_from_cleanup() {
        let (_temp, manager, workflow) = super::lifecycle_tests::prepared().await;
        manager
            .workflow_commands(&workflow.id, false)
            .await
            .unwrap();
        manager.workflow_preview(&workflow.id).await.unwrap();
        manager
            .workflow_integrate(&workflow.id, WorkflowDestination::WorkingTree)
            .await
            .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let target = manager
            .handoff_create(&workflow.implementation_session_id, input(&workflow, &id))
            .await
            .unwrap();
        assert!(manager
            .workflow_cleanup(&workflow.id)
            .await
            .unwrap_err()
            .to_string()
            .contains("unfinished linked task"));
        manager.update(&target.id, None, Some(true), false).unwrap();
        assert!(
            manager
                .workflow_cleanup(&workflow.id)
                .await
                .unwrap()
                .cleaned
        );
    }
}

/// A branch name and message that Git and a later reader can both work with. Git itself rejects most
/// malformed names, but checking here keeps the failure in RunHQ's own words.
fn validate_branch_request(branch: &str, message: &str) -> AppResult<()> {
    let name = branch.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(invalid("Enter a branch name"));
    }
    if name != branch {
        return Err(invalid("A branch name cannot start or end with whitespace"));
    }
    if name.starts_with('-')
        || name.ends_with('/')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains("//")
        || name
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c))
    {
        return Err(invalid(format!("{branch} is not a usable branch name")));
    }
    if message.trim().is_empty() {
        return Err(invalid("Enter a commit message"));
    }
    if message.len() > 5000 {
        return Err(invalid("The commit message is too long"));
    }
    Ok(())
}
