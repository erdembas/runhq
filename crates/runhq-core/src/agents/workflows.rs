//! Durable, explicitly advanced implementation → independent review → checks → apply.
//! A finished provider turn never counts as recorded validation or user acceptance.
use super::*;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

const OUTPUT_LIMIT: usize = 128 * 1024;
const PATCH_LIMIT: usize = 8 * 1024 * 1024;

#[path = "workflow_controls.rs"]
mod controls;
pub use controls::UpdateWorkflowSteps;

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
/// runs it, the settings to run it with, its own instruction, and the steps whose results it takes
/// as input.
///
/// `depends_on` names every step that must complete first, so a workflow is a graph rather than a
/// chain: steps that wait on nothing in common can run at the same time. The declared list is always
/// kept in topological order — a step may only depend on one declared before it — so reading the
/// steps in order is also a legal execution order.
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
    /// Reuse this earlier producing step's conversation, including provider-native context.
    #[serde(default)]
    pub continue_from: Option<String>,
    /// The single predecessor this step used to declare. Kept in sync with `depends_on.first()` so
    /// a build that predates the graph still reads the chain it understands.
    #[serde(default)]
    pub input_step_id: Option<String>,
    /// Every step that must complete before this one may run. Empty means the workflow's own base.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// This step's own instruction. Empty keeps the previous behaviour, where a step was described
    /// by the workflow objective and the sentence its role contributes.
    #[serde(default)]
    pub prompt: String,
    /// `shared` — the workflow's own checkout — or `own`, a checkout of this step's alone. Only a
    /// producing step may ask for its own, and only that makes two producers run at the same time:
    /// one checkout never carries two agents.
    #[serde(default)]
    pub workspace: String,
    /// The step's checkout and its Git toplevel. Set only for `own`.
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub root: Option<String>,
    /// `pending`, `running`, `completed`, `failed` or `blocked`.
    #[serde(default = "pending_status")]
    pub status: String,
    /// The workspace revision this step actually started from, recorded when it starts. A step's
    /// declared input says which step it follows; this says what that came to in practice.
    #[serde(default)]
    pub input_revision: Option<String>,
    /// What the step produced: the tree its checkout came to, and the commit RunHQ wrote for it so
    /// a later step can branch from a real revision.
    #[serde(default)]
    pub output_tree: Option<String>,
    #[serde(default)]
    pub output_revision: Option<String>,
    /// How this step's result landed in the workflow's shared checkout, once it has.
    #[serde(default)]
    pub merge: Option<WorkflowStepMerge>,
    /// The workflow generation this step was started in. A turn that finishes after the workflow
    /// moved on is recorded as superseded rather than counted.
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    /// Why this step failed or is blocked, in the words the screen shows.
    #[serde(default)]
    pub error: Option<String>,
    /// Empty preserves the behaviour of workflows saved before review decisions existed.
    #[serde(default)]
    pub review_policy: String,
    #[serde(default)]
    pub review_outcome: Option<String>,
    #[serde(default)]
    pub review_summary: Option<String>,
    #[serde(default)]
    pub review_decision: Option<String>,
    /// Automatic corrections are bounded to one attempt before asking the person.
    #[serde(default)]
    pub review_fix_attempts: u32,
}

impl WorkflowStep {
    /// The fields a migrated step carries no record of: it ran in the workflow's own checkout, under
    /// the workflow's objective, before any of this was written down.
    fn migrated() -> Self {
        WorkflowStep {
            id: String::new(),
            role: String::new(),
            target: String::new(),
            model: String::new(),
            effort: String::new(),
            mode: String::new(),
            session_id: None,
            continue_from: None,
            input_step_id: None,
            depends_on: vec![],
            prompt: String::new(),
            workspace: "shared".into(),
            cwd: None,
            root: None,
            status: pending_status(),
            input_revision: None,
            output_tree: None,
            output_revision: None,
            merge: None,
            generation: 0,
            started_at: None,
            finished_at: None,
            error: None,
            review_policy: String::new(),
            review_outcome: None,
            review_summary: None,
            review_decision: None,
            review_fix_attempts: 0,
        }
    }
    /// Whether this step runs in a checkout of its own rather than the workflow's.
    pub fn owns_workspace(&self) -> bool {
        self.workspace == "own"
    }
    /// The checkout a step works in: its own when it has one, else the workflow's.
    pub fn step_cwd<'a>(&'a self, workflow: &'a AgentWorkflow) -> &'a str {
        self.cwd.as_deref().unwrap_or(&workflow.cwd)
    }
    pub fn step_root<'a>(&'a self, workflow: &'a AgentWorkflow) -> &'a str {
        self.root.as_deref().unwrap_or(&workflow.root)
    }
}

/// What became of a step's result when it was applied to the workflow's shared checkout.
///
/// A conflict is recorded and reported; it is never resolved automatically, and it leaves the shared
/// checkout exactly as it was.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepMerge {
    pub applied_at: i64,
    /// The revision the step branched from, and the tree it produced.
    pub base_revision: String,
    pub source_fingerprint: String,
    /// The shared checkout's fingerprint after this landed.
    #[serde(default)]
    pub target_fingerprint: Option<String>,
    #[serde(default)]
    pub patch_bytes: u64,
    /// `applied`, `conflict` or `empty`.
    pub status: String,
    /// `git apply --check` output, verbatim.
    #[serde(default)]
    pub conflict: Option<String>,
}

fn pending_status() -> String {
    "pending".into()
}

/// A step id is also the key the person writes in another step's dependencies, so it has to stay
/// short, stable and typable.
fn valid_step_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Turn a declared list into the workflow's steps.
///
/// A step that declares no dependency follows the one before it, so a caller that predates the graph
/// still produces exactly the chain it always did. The first producing step is the session the
/// workflow was created with; the rest open theirs when they run, because a session belongs to the
/// account that started it.
fn workflow_declared_graph(
    declared: &[CreateWorkflowStep],
    implementation_session_id: &str,
    base_revision: &str,
) -> Vec<WorkflowStep> {
    let ids = declared_step_ids(declared);
    let dependencies = declared_dependencies(declared, &ids);
    let mut steps = Vec::new();
    for (index, step) in declared.iter().enumerate() {
        let depends_on = dependencies[index].clone();
        let owns = step.workspace.trim() == "own";
        steps.push(WorkflowStep {
            id: ids[index].clone(),
            role: step.role.clone(),
            target: step.target.clone(),
            model: step.model.clone(),
            effort: step.effort.clone(),
            mode: step.mode.clone(),
            continue_from: step.continue_from.clone(),
            // The session the workflow was created with owns its shared checkout, so the first
            // step is that session — unless it asked to work somewhere of its own, in which case
            // the shared checkout stays what the results are applied to.
            session_id: if index == 0 && !owns && !step.target.starts_with("pool:") {
                Some(implementation_session_id.to_string())
            } else {
                None
            },
            input_step_id: depends_on.first().cloned(),
            depends_on,
            prompt: step.prompt.clone(),
            workspace: if step.workspace.trim().is_empty() {
                "shared".into()
            } else {
                step.workspace.clone()
            },
            cwd: None,
            root: None,
            status: "pending".into(),
            input_revision: if index == 0 && !owns {
                Some(base_revision.to_string())
            } else {
                None
            },
            output_tree: None,
            output_revision: None,
            merge: None,
            generation: 0,
            started_at: None,
            finished_at: None,
            error: None,
            review_policy: step.review_policy.clone(),
            review_outcome: None,
            review_summary: None,
            review_decision: None,
            review_fix_attempts: 0,
        });
    }
    steps
}

/// What each declared step actually waits for: the dependencies it named, or — for a step that named
/// none — the step declared before it, so a caller that predates the graph still describes a chain.
fn declared_dependencies(declared: &[CreateWorkflowStep], ids: &[String]) -> Vec<Vec<String>> {
    declared
        .iter()
        .enumerate()
        .map(|(index, step)| match &step.depends_on {
            Some(declared) => declared.clone(),
            None if index > 0 => vec![ids[index - 1].clone()],
            None => vec![],
        })
        .collect()
}

/// The id each declared step will carry: the one it named, else the generated `<role>-<n>` this
/// workflow has always used.
fn declared_step_ids(declared: &[CreateWorkflowStep]) -> Vec<String> {
    declared
        .iter()
        .enumerate()
        .map(|(index, step)| match step.id.as_deref().map(str::trim) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => format!("{}-{}", step.role, index + 1),
        })
        .collect()
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

/// The name a step's session carries, so dozens of tasks are told apart in the task list: the step's
/// own first line when it has one, else the role and the workflow it belongs to.
fn workflow_step_title(w: &AgentWorkflow, step: &WorkflowStep) -> String {
    let own: String = step
        .prompt
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .chars()
        .take(80)
        .collect();
    if own.trim().is_empty() {
        format!("{} · {}", workflow_role_title(&step.role), w.title)
    } else {
        format!("{} · {}", workflow_role_title(&step.role), own.trim())
    }
}

/// What a step is being asked to do.
///
/// A step that carries its own instruction is asked that, under the workflow's objective as shared
/// context — dozens of tasks share one brief and still say different things. A step that carries
/// none is asked exactly what it always was: the objective itself.
fn workflow_step_task(w: &AgentWorkflow, step: &WorkflowStep) -> String {
    let own = step.prompt.trim();
    if own.is_empty() {
        return w.objective.clone();
    }
    if w.objective.trim().is_empty() {
        return own.to_string();
    }
    format!(
        "Shared context for this workflow:\n{}\n\nYour task:\n{own}",
        w.objective
    )
}

/// The sentence that names what this step does with the checkout. A step with its own instruction
/// has already said what it wants, so the sentence only has to name the kind of work.
fn workflow_step_instruction(step: &WorkflowStep) -> &'static str {
    if step.prompt.trim().is_empty() {
        workflow_role_instruction(&step.role)
    } else {
        match step.role.as_str() {
            "plan" => "carry out the task above as a plan",
            "revise" => "carry out the task above as a revision of the existing work",
            _ => "carry out the task above",
        }
    }
}

/// Stages that describe where the step graph is, and are therefore derived from it. The rest belong
/// to a phase that owns the whole checkout — setup, checks, integration — and only that phase writes
/// them, so a refresh never talks over an operation in flight.
pub(super) fn workflow_step_stage(stage: &str) -> bool {
    matches!(
        stage,
        "implementing"
            | "reviewing"
            | "implementation_ready"
            | "implementation_failed"
            | "review_ready"
            | "review_failed"
            | "checks_ready"
            | "awaiting_review"
    )
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
pub struct WorkflowStartDependency {
    pub session_id: String,
    pub title: String,
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
    /// Launch intent is persisted before the background scheduler starts, independently of UI.
    #[serde(default)]
    pub launch_pending: bool,
    #[serde(default)]
    pub start_after: Option<WorkflowStartDependency>,
    #[serde(default)]
    pub editing: bool,
    #[serde(default)]
    pub edit_revision: u64,
    /// How many of this workflow's steps may run at once. 0 derives the bound from the capacity
    /// settings, so a workflow does not have to restate what the account limits already say.
    #[serde(default)]
    pub concurrency: u32,
    /// Steps whose results were applied to the shared checkout, in the order they landed.
    #[serde(default)]
    pub joined: Vec<String>,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CreateWorkflowStep {
    pub role: String,
    pub target: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub mode: String,
    /// The key this step is known by, and that other steps name in `depends_on`. Left out, it is
    /// the generated `<role>-<n>`.
    #[serde(default)]
    pub id: Option<String>,
    /// This step's own instruction.
    #[serde(default)]
    pub prompt: String,
    /// Ids of steps declared before this one. An empty list is a task that waits for nothing;
    /// leaving the field out entirely follows the step before it, which is what a caller that
    /// predates the graph means by an ordered list.
    #[serde(default)]
    pub depends_on: Option<Vec<String>>,
    /// `""`/`shared`, or `own` for a checkout of this step's alone.
    #[serde(default)]
    pub workspace: String,
    #[serde(default)]
    pub continue_from: Option<String>,
    #[serde(default)]
    pub review_policy: String,
}
pub const MAX_WORKFLOW_STEPS: usize = 64;
/// A step's own instruction is bounded like the workflow objective it stands in for.
pub const MAX_STEP_PROMPT: usize = 128 * 1024;

#[derive(Debug, Default, Deserialize)]
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
    /// How many steps may run at once. 0 derives the bound from the capacity settings.
    #[serde(default)]
    pub concurrency: u32,
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
        if self.steps.is_empty() {
            self.steps = vec![
                WorkflowStep {
                    id: "implement".into(),
                    role: "implement".into(),
                    session_id: Some(self.implementation_session_id.clone()),
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
                    ..WorkflowStep::migrated()
                },
                WorkflowStep {
                    id: "review".into(),
                    role: "review".into(),
                    target: self.reviewer_backend.clone(),
                    model: self.reviewer_model.clone(),
                    session_id: self.review_session_id.clone(),
                    input_step_id: Some("implement".into()),
                    depends_on: vec!["implement".into()],
                    status: match self.stage.as_str() {
                        "reviewing" => "running".into(),
                        "review_failed" => "failed".into(),
                        _ if self.review_session_id.is_some() => "completed".into(),
                        _ => "pending".into(),
                    },
                    input_revision: self.review_fingerprint.clone(),
                    ..WorkflowStep::migrated()
                },
            ];
            return;
        }
        // Rows written before a workflow was a graph read as the chain they declared: a step with no
        // dependencies of its own keeps the single predecessor it recorded. The pass is idempotent —
        // a genuine root has no `input_step_id` to fold in — so re-reading a row changes nothing.
        self.normalize_steps();
    }

    /// Fill in what a graph needs from what a chain recorded, without touching anything already set.
    pub(super) fn normalize_steps(&mut self) {
        for step in &mut self.steps {
            if step.depends_on.is_empty() {
                if let Some(previous) = step.input_step_id.clone() {
                    step.depends_on.push(previous);
                }
            }
            step.input_step_id = step.depends_on.first().cloned();
            if step.workspace.trim().is_empty() {
                step.workspace = "shared".into();
            }
        }
    }
    pub fn step(&self, id: &str) -> Option<&WorkflowStep> {
        self.steps.iter().find(|step| step.id == id)
    }
    /// The step the workflow is on: the running one, else the first that could start now, else the
    /// first that has not completed. A failed step stays current, because retrying it is the explicit
    /// next action rather than skipping it.
    pub fn current_step(&self) -> Option<&WorkflowStep> {
        self.steps
            .iter()
            .find(|step| step.status == "running")
            .or_else(|| self.runnable_steps().into_iter().next())
            .or_else(|| self.steps.iter().find(|step| step.status != "completed"))
    }
    /// Steps that could start right now: waiting, with every step they depend on completed and, for
    /// a dependency that produced changes in a checkout of its own, landed in the shared one.
    pub fn runnable_steps(&self) -> Vec<&WorkflowStep> {
        self.steps
            .iter()
            .filter(|step| step.status == "pending" && self.dependencies_ready(step))
            .collect()
    }
    fn dependencies_ready(&self, step: &WorkflowStep) -> bool {
        step.depends_on.iter().all(|id| {
            self.step(id).is_some_and(|dependency| {
                dependency.status == "completed"
                    && !dependency.review_needs_decision()
                    && !self.awaiting_join(dependency)
            })
        })
    }
    /// Producing steps whose result has not yet been applied to the shared checkout.
    pub fn unjoined(&self) -> Vec<&WorkflowStep> {
        self.steps
            .iter()
            .filter(|step| self.awaiting_join(step))
            .collect()
    }
    fn awaiting_join(&self, step: &WorkflowStep) -> bool {
        workflow_role_produces(&step.role)
            && step.owns_workspace()
            && step.status == "completed"
            && !matches!(
                step.merge.as_ref().map(|merge| merge.status.as_str()),
                Some("applied") | Some("empty")
            )
    }
    /// Whether this step is the review that unlocks integration: it reads the shared checkout and
    /// every step that produces work is behind it, so what it saw is the finished result.
    pub fn gates_integration(&self, step: &WorkflowStep) -> bool {
        if workflow_role_produces(&step.role) || step.owns_workspace() {
            return false;
        }
        let ancestors = self.ancestors(&step.id);
        self.steps
            .iter()
            .filter(|other| workflow_role_produces(&other.role))
            .all(|producer| ancestors.contains(&producer.id))
    }
    fn ancestors(&self, id: &str) -> std::collections::BTreeSet<String> {
        let mut seen = std::collections::BTreeSet::new();
        let mut pending: Vec<String> = match self.step(id) {
            Some(step) => step.depends_on.clone(),
            None => vec![],
        };
        while let Some(next) = pending.pop() {
            if !seen.insert(next.clone()) {
                continue;
            }
            if let Some(step) = self.step(&next) {
                pending.extend(step.depends_on.iter().cloned());
            }
        }
        seen
    }
    /// The stage the step graph itself is in.
    ///
    /// With several steps able to run at once there is no single step whose state is the workflow's,
    /// so the stage is read off the graph: what is running, what failed, and whether anything is
    /// still to do. The phases that own the checkout as a whole — setup, checks, integration — keep
    /// writing their own stage and are never derived.
    pub fn steps_stage(&self) -> String {
        let running: Vec<&WorkflowStep> = self
            .steps
            .iter()
            .filter(|step| step.status == "running")
            .collect();
        if running
            .iter()
            .any(|step| workflow_role_produces(&step.role))
        {
            return "implementing".into();
        }
        if !running.is_empty() {
            return "reviewing".into();
        }
        if self.awaiting_review() {
            return "awaiting_review".into();
        }
        if let Some(stopped) = self
            .steps
            .iter()
            .find(|step| matches!(step.status.as_str(), "failed" | "blocked"))
        {
            return if workflow_role_produces(&stopped.role) {
                "implementation_failed"
            } else {
                "review_failed"
            }
            .into();
        }
        if self.steps.iter().all(|step| step.status == "completed") && self.unjoined().is_empty() {
            return "checks_ready".into();
        }
        if self
            .runnable_steps()
            .iter()
            .any(|step| workflow_role_produces(&step.role))
        {
            "implementation_ready".into()
        } else {
            "review_ready".into()
        }
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
    pub(super) fn workflow(&self, id: &str) -> AppResult<AgentWorkflow> {
        self.workflow_rows()?
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| invalid("Unknown agent workflow"))
    }
    pub(super) fn save_workflow(&self, w: &mut AgentWorkflow) -> AppResult<()> {
        w.updated_at = now();
        // `input_step_id` is written for readers that predate the graph, so it never drifts from the
        // dependency it stands for.
        w.normalize_steps();
        self.state.lock().db.conn.execute("INSERT INTO agent_workflows(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![w.id, serde_json::to_string(w)?])
            .map_err(|e| AppError::other(e.to_string()))?;
        Ok(())
    }
    pub(super) fn recover_workflows(&self) -> AppResult<()> {
        for mut w in self.workflow_rows()? {
            if w.launch_pending {
                w.launch_pending = false;
                w.auto_progress = false;
                w.generation += 1;
                if !w.steps.iter().any(|step| step.started_at.is_some())
                    && !matches!(w.stage.as_str(), "setting_up" | "checking" | "integrating")
                {
                    w.stage = "launch_paused".into();
                }
                w.error = Some("Queued start paused after restart. Review the preceding task and choose when to start again.".into());
                self.save_workflow(&mut w)?;
            }
            if w.auto_progress && !matches!(w.stage.as_str(), "integrated" | "ready") {
                w.auto_progress = false;
                w.error = Some("Automatic progression paused after restart. Inspect the workspace and choose the next step explicitly.".into());
                self.save_workflow(&mut w)?;
            }
            // A step that was running when RunHQ exited is not running now. Its checkout and
            // evidence are kept; restarting it is an explicit action.
            if w.steps.iter().any(|step| step.status == "running") {
                for step in w.steps.iter_mut().filter(|step| step.status == "running") {
                    step.status = "failed".into();
                    step.finished_at = Some(now());
                    step.error = Some(
                        "RunHQ exited while this step was running; nothing was replayed.".into(),
                    );
                }
                w.generation += 1;
                if workflow_step_stage(&w.stage) {
                    w.stage = w.steps_stage();
                }
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
            let reviewing = w.review_session_id.as_deref() == Some(&session.id)
                || w.steps.iter().any(|step| {
                    step.session_id.as_deref() == Some(&session.id)
                        && !workflow_role_produces(&step.role)
                });
            if reviewing
                && (input.mode.as_deref().unwrap_or(&session.mode) != "plan"
                    || !input.agent.as_deref().unwrap_or(&session.agent).is_empty())
            {
                return Err(invalid("Independent workflow reviews stay in read-only plan mode. Continue implementation in its original task."));
            }
            let belongs = w.implementation_session_id == session.id
                || w.review_session_id.as_deref() == Some(&session.id)
                || w.steps
                    .iter()
                    .any(|step| step.session_id.as_deref() == Some(&session.id));
            if belongs
                && (w.editing
                    || w.awaiting_review()
                    || w.start_after.is_some()
                    || matches!(
                        w.stage.as_str(),
                        "waiting" | "launching" | "launch_failed" | "launch_paused"
                    ))
            {
                return Err(invalid("This workflow is waiting to start. Choose its start timing from Workflows first."));
            }
            if belongs && (w.cleaned || w.stage == "integrated") {
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
    pub(super) async fn reconcile_workflow(&self, w: &mut AgentWorkflow) -> AppResult<()> {
        let old = serde_json::to_string(w)?;
        // A running step is finished by its session, not by a stage name. The stage then says what
        // the workflow as a whole is waiting for: another step, or validation once every step ran.
        if workflow_step_stage(&w.stage) {
            // Every running step is settled from its own session, not one of them from the stage.
            let running: Vec<(String, Option<String>, u64)> = w
                .steps
                .iter()
                .filter(|step| step.status == "running")
                .map(|step| (step.id.clone(), step.session_id.clone(), step.generation))
                .collect();
            let mut failure: Option<String> = None;
            let mut settled = false;
            let mut shared_result = false;
            for (id, session_id, generation) in running {
                let Some(session) = session_id.map(|id| self.session(&id)).transpose()? else {
                    continue;
                };
                if session.active() {
                    continue;
                }
                // A turn that outlived the workflow it was started in is recorded as superseded: its
                // result belongs to a revision the workflow has already moved past.
                let superseded = generation != w.generation;
                let completed = session.status == "completed" && !superseded;
                if !completed && failure.is_none() {
                    failure = Some(if superseded {
                        "A step finished after the workflow moved on; its result was not counted."
                            .into()
                    } else {
                        session
                            .last_error
                            .clone()
                            .unwrap_or_else(|| format!("Step {id} did not complete"))
                    });
                }
                settled = true;
                if let Some(step) = w.steps.iter_mut().find(|step| step.id == id) {
                    shared_result |=
                        completed && workflow_role_produces(&step.role) && !step.owns_workspace();
                    step.status = if completed { "completed" } else { "failed" }.into();
                    step.finished_at = Some(now());
                    step.error = if completed { None } else { failure.clone() };
                    if completed && !workflow_role_produces(&step.role) {
                        self.workflow_set_review_result(step);
                    }
                }
            }
            if shared_result {
                // Changes produced by a declared shared step are expected. Record them before
                // joining a sibling's result, whose staleness guard rejects outside edits.
                let _lease = self.workflow_lease(Path::new(&w.root))?;
                w.current_fingerprint = Some(self.workflow_fingerprint(Path::new(&w.root)).await?);
            }
            // An error is the last settled step's, so a finished step clears the one before it — and
            // a refresh that settled nothing leaves whatever was recorded standing.
            if settled {
                w.error = failure;
            }
            // What a step produced in a checkout of its own is written down as soon as it finishes,
            // so a step that follows it has a revision to branch from.
            let produced: Vec<String> = w
                .steps
                .iter()
                .filter(|step| {
                    step.status == "completed"
                        && step.owns_workspace()
                        && step.output_revision.is_none()
                        && step.root.is_some()
                })
                .map(|step| step.id.clone())
                .collect();
            for id in produced {
                if let Err(error) = self.workflow_record_output(w, &id).await {
                    w.error = Some(format!(
                        "Recording what step {id:?} produced failed: {error}"
                    ));
                }
            }
            if !w.editing && !w.steps.iter().any(|step| step.status == "running") {
                let automatic = w
                    .steps
                    .iter()
                    .find(|step| {
                        step.review_needs_decision()
                            && step.review_policy == "auto_fix"
                            && step.review_fix_attempts == 0
                            && step.review_outcome.as_deref() == Some("findings")
                    })
                    .map(|step| step.id.clone());
                if let Some(id) = automatic {
                    let mut corrected = w.clone();
                    match self.workflow_insert_review_fix(&mut corrected, &id) {
                        Ok(()) => *w = corrected,
                        Err(error) => {
                            let step = w.steps.iter_mut().find(|step| step.id == id).unwrap();
                            step.review_fix_attempts = 1;
                            step.review_summary =
                                Some(format!("Automatic correction could not be added: {error}"));
                        }
                    }
                }
            }
            w.stage = w.steps_stage();
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
                        w.preview = None;
                        // Every review that read an older revision becomes a step to run again.
                        // Without this the workflow would have no current step and nothing could
                        // be started, leaving a changed workspace stuck short of validation.
                        for step in w.steps.iter_mut().filter(|step| {
                            !workflow_role_produces(&step.role)
                                && step.input_revision.as_ref() != Some(&current)
                        }) {
                            step.status = "pending".into();
                            step.input_revision = None;
                        }
                        w.stage = "review_ready".into();
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
        // A workflow says what it is for either in one brief or in the tasks themselves, and with
        // dozens of tasks the brief is often the redundant half.
        let described = !input.objective.trim().is_empty()
            || (!input.steps.is_empty()
                && input
                    .steps
                    .iter()
                    .all(|step| !step.prompt.trim().is_empty()));
        if !described || input.objective.len() > 128 * 1024 || input.acceptance.len() > 64 * 1024 {
            return Err(invalid(
                "Give this workflow an objective, or an instruction for every task, with bounded acceptance criteria",
            ));
        }
        validate_commands(&input.check_commands, false)?;
        validate_commands(&input.setup_commands, false)?;
        // A declared step list is checked before anything is created, so an unusable division of
        // labour is refused rather than half-built.
        if input.steps.len() > MAX_WORKFLOW_STEPS {
            return Err(invalid(format!(
                "A workflow runs at most {MAX_WORKFLOW_STEPS} steps"
            )));
        }
        validate_declared_graph(&input.steps)?;
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
        // The name is the brief's first line, or — when the tasks carry the description — the first
        // task's, so a workflow is never listed as "Agent workflow".
        let title: String = input
            .objective
            .lines()
            .find(|line| !line.trim().is_empty())
            .or_else(|| {
                input
                    .steps
                    .first()
                    .and_then(|step| step.prompt.lines().find(|line| !line.trim().is_empty()))
            })
            .unwrap_or("Agent workflow")
            .chars()
            .take(100)
            .collect();
        let session = self
            .create_at_base(
                CreateAgentSession {
                    creation_request_id: None,
                    project_id: input.project_id.clone(),
                    backend: self.resolve_step_target(
                        input
                            .steps
                            .first()
                            .map(|step| step.target.as_str())
                            .unwrap_or(&input.backend),
                        false,
                    )?,
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
            launch_pending: false,
            start_after: None,
            editing: false,
            edit_revision: 0,
            concurrency: input.concurrency,
            joined: vec![],
            generation: 0,
            transferred_files: vec![],
            integration_branch: None,
            integration_commit: None,
        };
        w.steps =
            workflow_declared_graph(&input.steps, &w.implementation_session_id, &w.base_revision);
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
        if w.auto_progress {
            let manager = Arc::clone(self);
            let workflow_id = w.id.clone();
            let generation = w.generation;
            tokio::spawn(async move {
                manager
                    .workflow_scheduler_loop(workflow_id, generation)
                    .await;
            });
        }
        Ok(w)
    }

    /// Run one named task, whichever role it plays.
    ///
    /// With a graph there is rarely one obvious next step, so a person points at the one they mean.
    /// It still has to be a task that could run: its dependencies finished, their results landed,
    /// and a free checkout and account to run in.
    pub async fn workflow_run_named_step(
        self: &Arc<Self>,
        id: &str,
        step_id: &str,
    ) -> AppResult<AgentWorkflow> {
        let outcome =
            {
                let _gate = self.workflow_gate.lock().await;
                let mut w = self.workflow(id)?;
                self.reconcile_workflow(&mut w).await?;
                if !Self::workflow_accepts_steps(&w) {
                    return Err(invalid(
                        "Finish setup or stop this workflow's current operation first",
                    ));
                }
                // Retry is an explicit action. Scheduling still considers pending steps only,
                // so failures never replay themselves in the background.
                if let Some(step) = w.steps.iter_mut().find(|step| step.id == step_id) {
                    if step.status == "failed" {
                        step.status = "pending".into();
                    }
                }
                let step = w
                    .step(step_id)
                    .cloned()
                    .ok_or_else(|| invalid("Unknown workflow step"))?;
                match self.workflow_step_wait(&w, &step, &[]) {
                    StepWait::Ready => {}
                    StepWait::Dependencies => {
                        return Err(invalid(
                            "This task is waiting for the tasks it depends on to finish",
                        ))
                    }
                    StepWait::Checkout => {
                        return Err(invalid(
                            "Another agent is using the checkout this task runs in",
                        ))
                    }
                    StepWait::Capacity => return Err(invalid(
                        "No free account slot for this task. Wait, or change capacity settings.",
                    )),
                    StepWait::WorkflowLimit => {
                        return Err(invalid(
                            "This workflow is already running as many tasks at once as it allows",
                        ))
                    }
                }
                if workflow_role_produces(&step.role) {
                    self.workflow_start_producing(&mut w, step).await
                } else {
                    self.workflow_start_reviewing(&mut w, step).await
                }
            };
        let w = outcome?;
        if w.auto_progress {
            let manager = Arc::clone(self);
            let workflow_id = w.id.clone();
            let generation = w.generation;
            tokio::spawn(async move {
                manager
                    .workflow_scheduler_loop(workflow_id, generation)
                    .await;
            });
        }
        Ok(w)
    }

    async fn workflow_run_step_inner(self: &Arc<Self>, id: &str) -> AppResult<AgentWorkflow> {
        let _gate = self.workflow_gate.lock().await;
        let mut w = self.workflow(id)?;
        self.reconcile_workflow(&mut w).await?;
        if !Self::workflow_idle(&w.stage) || !Self::workflow_accepts_steps(&w) {
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

    pub(super) async fn workflow_start_producing(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        if !w.setup_commands.is_empty() && !commands_passed(&w.setup_commands, &w.setup) {
            return Err(invalid("Complete the setup commands before implementation"));
        }
        let continued_session =
            if let Some(previous_id) = &step.continue_from {
                let previous = w
                    .step(previous_id)
                    .ok_or_else(|| invalid("The conversation's previous step is missing"))?;
                if !workflow_role_produces(&step.role)
                    || !workflow_role_produces(&previous.role)
                    || step.owns_workspace()
                    || previous.owns_workspace()
                    || previous.target != step.target
                    || previous.status != "completed"
                    || !w.ancestors(&step.id).contains(previous_id)
                {
                    return Err(invalid(
                        "Continue a completed prompt on the same agent and shared working copy",
                    ));
                }
                Some(previous.session_id.clone().ok_or_else(|| {
                    invalid("The previous prompt has no conversation to continue")
                })?)
            } else {
                None
            };
        let existing_session = step.session_id.clone().or(continued_session);
        let target = match &existing_session {
            Some(id) => self.session(id)?.backend,
            None => self.resolve_step_target(&step.target, false)?,
        };
        // The first producing step owns the session created with the workflow; later steps open
        // their own unless they explicitly continue an earlier conversation. A step that asked for a
        // checkout of its own gets one here, branched from what its dependencies produced — that is
        // what lets two producing steps run at the same time, since one checkout never carries two.
        let session = match &existing_session {
            Some(id) => {
                let session = self.session(id)?;
                if session.workflow_read_only
                    || Path::new(&session.cwd).canonicalize()?
                        != Path::new(step.step_cwd(w)).canonicalize()?
                {
                    return Err(invalid(
                        "The conversation no longer belongs to this workflow's working copy",
                    ));
                }
                session
            }
            None if step.owns_workspace() => {
                let base = self.workflow_branch_point(w, &step).await?;
                let created = self
                    .create_at_base(
                        CreateAgentSession {
                            creation_request_id: None,
                            project_id: w.project_id.clone(),
                            backend: target.clone(),
                            executable: String::new(),
                            title: workflow_step_title(w, &step),
                            model: step.model.clone(),
                            effort: step.effort.clone(),
                            mode: "default".into(),
                            agent: String::new(),
                            isolated: true,
                        },
                        &base,
                    )
                    .await?;
                let root = git_toplevel(Path::new(&created.cwd))
                    .await?
                    .to_string_lossy()
                    .into_owned();
                let cwd: String = PathBuf::from(&created.cwd)
                    .canonicalize()?
                    .to_string_lossy()
                    .into();
                // The environment a workflow was given belongs to every checkout it opens, or a
                // parallel step would run without the files the shared one was set up with.
                self.workflow_copy_transferred(w, Path::new(&cwd))?;
                if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id) {
                    current.cwd = Some(cwd);
                    current.root = Some(root);
                    current.input_revision = Some(base.clone());
                }
                created
            }
            None => {
                let created = self
                    .create(CreateAgentSession {
                        creation_request_id: None,
                        project_id: w.project_id.clone(),
                        backend: target.clone(),
                        executable: String::new(),
                        title: workflow_step_title(w, &step),
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
        // A step reloads the shape it may have just been given a checkout in.
        let step = w.step(&step.id).cloned().unwrap_or(step);
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
        // A step in its own checkout branched from a revision that was recorded when it was created;
        // one in the shared checkout starts from wherever that stands.
        let input_revision = step
            .input_revision
            .clone()
            .filter(|_| step.owns_workspace())
            .unwrap_or_else(|| w.step_input_revision(&step));
        w.review_fingerprint = None;
        w.preview = None;
        w.checks.clear();
        w.error = None;
        w.stage = "implementing".into();
        let generation = w.generation;
        if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id) {
            current.status = "running".into();
            current.session_id = Some(session.id.clone());
            current.input_revision = Some(input_revision.clone());
            // A step remembers the generation it belongs to, so a turn that finishes after the
            // workflow moved on is recorded as superseded instead of counted.
            current.generation = generation;
            current.started_at = Some(now());
            current.finished_at = None;
            current.error = None;
            current.merge = None;
            current.output_tree = None;
            current.output_revision = None;
            if current.target.is_empty() {
                current.target = session.backend.clone();
            }
        }
        // The legacy field keeps naming the session that works in the workflow's own checkout, so
        // everything that still reads it — recovery, fingerprints, the review's branch — keeps
        // agreeing. A step working somewhere else is not that session.
        if !step.owns_workspace() {
            w.implementation_session_id = session.id.clone();
        }
        self.save_workflow(w)?;
        let prompt = format!(
            "{}\n\nAcceptance criteria:\n{}\n\nWorkflow: {} in this isolated checkout. Do not merge, push, or apply changes to the original project. An independent agent will review your changes against base {} and RunHQ will execute these checks: {}.\nSummarize the result and remaining risks.\n\nPrevious independent review (when revising, address its findings or explain why they do not apply):\n{}\n\nRecorded failed checks from the previous attempt:\n{}",
            workflow_step_task(w, &step),
            w.acceptance,
            workflow_step_instruction(&step),
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
                // Explicit continuation steps own their settings, including a return to Auto.
                // Migrated workflows still inherit the original session's saved defaults.
                model: if step.continue_from.is_none() && step.model.is_empty() {
                    session.model
                } else {
                    step.model.clone()
                },
                effort: if step.continue_from.is_none()
                    && step.model.is_empty()
                    && step.effort.is_empty()
                {
                    session.effort
                } else {
                    step.effort.clone()
                },
                mode: Some(workflow_step_mode(&step.role, &session.adapter).to_string()),
                agent: Some(String::new()),
                attachments: vec![],
            })
            .await
        {
            w.error = Some(error.to_string());
            if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id) {
                current.status = "failed".into();
                current.finished_at = Some(now());
                current.error = Some(error.to_string());
            }
            // The stage follows from the steps: a sibling that is still running is still running.
            w.stage = w.steps_stage();
            self.save_workflow(w)?;
        }
        Ok(w.clone())
    }

    pub(super) async fn workflow_start_reviewing(
        self: &Arc<Self>,
        w: &mut AgentWorkflow,
        step: WorkflowStep,
    ) -> AppResult<AgentWorkflow> {
        // What this review reads is what the steps it depends on produced, so those must have
        // finished and — for one that worked in a checkout of its own — have landed here.
        for id in &step.depends_on {
            let Some(dependency) = w.step(id) else {
                continue;
            };
            if dependency.status != "completed" {
                return Err(invalid(format!(
                    "Step {id:?} must complete successfully before this review"
                )));
            }
            if w.unjoined().iter().any(|step| &step.id == id) {
                return Err(invalid(format!(
                    "Step {id:?} has not been applied to this workflow's checkout yet"
                )));
            }
        }
        if step.depends_on.is_empty()
            && self.session(&w.implementation_session_id)?.status != "completed"
        {
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
                    self.resolve_step_target(&step.target, true)?
                },
                executable: String::new(),
                title: workflow_step_title(w, &step),
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
        let generation = w.generation;
        if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id) {
            current.status = "running".into();
            current.session_id = Some(reviewer.id.clone());
            current.input_revision = Some(fingerprint.clone());
            current.generation = generation;
            current.started_at = Some(now());
            current.finished_at = None;
            current.error = None;
            current.review_outcome = None;
            current.review_summary = None;
            current.review_decision = None;
            if current.target.is_empty() {
                current.target = reviewer.backend.clone();
            }
        }
        self.save_workflow(w)?;
        let mut prompt = format!("Independently review this implementation. Read-only review: do not edit files, commit, switch branches, install dependencies, or request write permissions.\n\nObjective:\n{}\n\nAcceptance criteria:\n{}\n\nCompare the current checkout (including new files) against base commit {}. The captured complete workspace tree is {}. Inspect git diff {} and untracked files. Report concrete findings with severity and locations; state explicitly when you find no issues. Review findings will be shown to the user before they choose whether to apply changes.\n\nRequested validation commands:\n{}", workflow_step_task(w, &step), w.acceptance, w.base_revision, fingerprint, w.base_revision, w.check_commands.join("\n"));
        if !matches!(step.review_policy.as_str(), "" | "continue") {
            prompt.push_str("\n\nEnd your final response with exactly one line in this format (not a code block):\nRUNHQ_REVIEW_RESULT: {\"verdict\":\"pass\",\"summary\":\"Brief reason\"}\nUse verdict \"findings\" when any actionable issue remains. Use \"pass\" only when no actionable issues remain. Keep detailed findings above this line. This verdict describes the review; it is not approval to apply changes.");
        }
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
            w.error = Some(error.to_string());
            if let Some(current) = w.steps.iter_mut().find(|current| current.id == step.id) {
                current.status = "failed".into();
                current.finished_at = Some(now());
                current.error = Some(error.to_string());
            }
            // The stage follows from the steps: a sibling that is still running is still running.
            w.stage = w.steps_stage();
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
        // A step that works in a checkout of its own is still this workflow's, so the environment
        // files it was given are excluded from its fingerprint too.
        let workflow = self.workflow_rows()?.into_iter().find(|w| {
            Path::new(&w.root) == root
                || w.steps
                    .iter()
                    .any(|step| step.root.as_deref().map(Path::new) == Some(root))
        });
        let environment: Vec<PathBuf> = workflow
            .as_ref()
            .map(|w| {
                // The environment sits where the workflow's own checkout keeps it, at the same
                // place inside whichever checkout is being fingerprinted.
                let inside = Path::new(&w.cwd)
                    .strip_prefix(&w.root)
                    .unwrap_or(Path::new(""));
                w.transferred_files
                    .iter()
                    .map(|file| root.join(inside).join(&file.path))
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
    /// The account a step actually runs on.
    ///
    /// A pool names interchangeable accounts and is resolved when the step starts, not when it is
    /// declared, so the choice reflects what is free at that moment. The step keeps naming the pool;
    /// the session records which member was chosen.
    pub(super) fn resolve_step_target(&self, target: &str, read_only: bool) -> AppResult<String> {
        let Some(id) = target.strip_prefix("pool:") else {
            return Ok(target.to_string());
        };
        let record = self
            .workspace_record(&format!("pool:{id}"))?
            .ok_or_else(|| invalid(format!("Account pool {id:?} no longer exists")))?;
        let members: Vec<String> = record.value["accounts"]
            .as_array()
            .map(|accounts| {
                accounts
                    .iter()
                    .filter_map(|account| account.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let cooldowns = self
            .workspace_record("preferences:cooldowns")?
            .map(|record| record.value)
            .unwrap_or(Value::Null);
        let state = self.state.lock();
        let mut best: Option<(String, usize)> = None;
        for member in members {
            let Some(tool) = state.tools.get(&member) else {
                continue;
            };
            if !tool.enabled
                || resolve_executable(&tool.executable, "").is_err()
                || (read_only && !matches!(tool.adapter.as_str(), "codex" | "claude"))
                || cooldowns[&member]["until"]
                    .as_f64()
                    .is_some_and(|until| until > now() as f64)
            {
                continue;
            }
            let (global, provider) = Self::capacity_limits(&state.db.conn, &member)?;
            if state.running.len() >= global {
                return Err(invalid("Waiting for a global execution slot"));
            }
            let busy = state
                .running
                .keys()
                .filter(|id| {
                    state
                        .sessions
                        .get(*id)
                        .is_some_and(|session| session.backend == member)
                })
                .count();
            let free = provider.saturating_sub(busy);
            if free > 0 && best.as_ref().map_or(true, |(_, previous)| free > *previous) {
                best = Some((member, free));
            }
        }
        best.map(|(member, _)| member).ok_or_else(|| {
            invalid(format!(
                "Every compatible account in pool {id:?} is busy, on cool-down, or unavailable"
            ))
        })
    }

    /// The revision a step's own checkout branches from.
    ///
    /// One producing dependency means that step's result; several mean their results merged in the
    /// object database, which is also where a disagreement between them shows up — and where it
    /// stops, because a step whose inputs conflict is not started.
    async fn workflow_branch_point(
        &self,
        w: &AgentWorkflow,
        step: &WorkflowStep,
    ) -> AppResult<String> {
        let mut revisions: Vec<String> = Vec::new();
        for id in &step.depends_on {
            let Some(dependency) = w.step(id) else {
                continue;
            };
            if !workflow_role_produces(&dependency.role) {
                continue;
            }
            let revision = match &dependency.output_revision {
                Some(revision) => revision.clone(),
                // A dependency that worked in the shared checkout has its result there; it becomes
                // something to branch from by being written down as a commit.
                None => self.workflow_shared_revision(w).await?,
            };
            if !revisions.contains(&revision) {
                revisions.push(revision);
            }
        }
        let Some((first, rest)) = revisions.split_first() else {
            return Ok(w.base_revision.clone());
        };
        let root = Path::new(&w.root);
        let mut merged = first.clone();
        for next in rest {
            match merge_trees(root, &merged, next).await? {
                Ok(tree) => {
                    merged = commit_tree(
                        root,
                        &tree,
                        &[merged.clone(), next.clone()],
                        &format!("runhq: {} · inputs for {}", w.title, step.id),
                    )
                    .await?
                }
                Err(conflicts) => {
                    return Err(invalid(format!(
                        "The results this step builds on disagree and were not merged:\n{conflicts}"
                    )))
                }
            }
        }
        Ok(merged)
    }

    /// The workflow's shared checkout as a commit, so a step can branch from where it stands.
    async fn workflow_shared_revision(&self, w: &AgentWorkflow) -> AppResult<String> {
        let root = Path::new(&w.root);
        let tree = self.workflow_fingerprint(root).await?;
        commit_tree(
            root,
            &tree,
            std::slice::from_ref(&w.base_revision),
            &format!("runhq: {} · shared checkout", w.title),
        )
        .await
    }

    /// Copy the environment files a workflow was given into a checkout it has just opened.
    ///
    /// Their content is deliberately outside the patch and the database; a step that runs in its own
    /// checkout still needs them, so they are copied from the workflow's checkout rather than read
    /// from anywhere they were recorded.
    fn workflow_copy_transferred(&self, w: &AgentWorkflow, destination: &Path) -> AppResult<()> {
        for file in &w.transferred_files {
            let relative = safe_relative_file(&file.path)?;
            let source = Path::new(&w.cwd).join(&relative);
            if !source.is_file() {
                continue;
            }
            let target = destination.join(&relative);
            let parent = target
                .parent()
                .ok_or_else(|| invalid("Invalid environment destination"))?;
            std::fs::create_dir_all(parent)?;
            std::fs::copy(&source, &target)?;
            std::fs::set_permissions(&target, std::fs::metadata(&source)?.permissions())?;
        }
        Ok(())
    }

    /// Record what a step that worked in its own checkout produced.
    ///
    /// A working tree is not something another step can branch from, so the result is written as a
    /// commit on that checkout's own branch — the branch `create_at_base` already made for it. The
    /// index is moved with it, so the step's worktree reads as what it produced rather than as a
    /// tree full of pending changes.
    async fn workflow_record_output(&self, w: &mut AgentWorkflow, id: &str) -> AppResult<()> {
        let Some(step) = w.step(id).cloned() else {
            return Ok(());
        };
        if !workflow_role_produces(&step.role) || !step.owns_workspace() {
            return Ok(());
        }
        let Some(root) = step.root.clone() else {
            return Ok(());
        };
        let root = PathBuf::from(root);
        let tree = self.workflow_fingerprint(&root).await?;
        let parent = step
            .input_revision
            .clone()
            .unwrap_or_else(|| w.base_revision.clone());
        let commit = commit_tree(
            &root,
            &tree,
            &[parent],
            &format!("runhq: {} · {}", w.title, step.id),
        )
        .await?;
        let mut reset: Vec<String> = RUNHQ_COMMITTER.iter().map(|a| a.to_string()).collect();
        reset.extend(["reset".to_string(), "--mixed".to_string(), commit.clone()]);
        git_output(&root, &reset.iter().map(String::as_str).collect::<Vec<_>>()).await?;
        if let Some(step) = w.steps.iter_mut().find(|step| step.id == id) {
            step.output_tree = Some(tree);
            step.output_revision = Some(commit);
        }
        Ok(())
    }

    /// Apply what a step produced in its own checkout to the workflow's shared one.
    ///
    /// Only this step's own difference is applied, so two steps that ran at the same time do not
    /// re-apply each other's work. A conflict is recorded with the paths Git named and leaves the
    /// shared checkout exactly as it was: results that disagree are a decision for the person, and
    /// until one is made the workflow cannot reach validation or integration.
    pub(super) async fn workflow_join_step(
        &self,
        w: &mut AgentWorkflow,
        id: &str,
    ) -> AppResult<()> {
        let Some(step) = w.step(id).cloned() else {
            return Ok(());
        };
        let (Some(tree), Some(base)) = (step.output_tree.clone(), step.input_revision.clone())
        else {
            return Ok(());
        };
        let shared = Path::new(&w.root);
        let _lease = self.workflow_lease(shared)?;
        let current = self.workflow_fingerprint(shared).await?;
        if w.current_fingerprint
            .as_ref()
            .is_some_and(|known| known != &current)
        {
            return Err(invalid(
                "This workflow's checkout changed outside the workflow. Inspect it before applying more step results.",
            ));
        }
        let patch = workflow_patch_between(shared, &base, &tree).await?;
        let mut merge = WorkflowStepMerge {
            applied_at: now(),
            base_revision: base,
            source_fingerprint: tree,
            target_fingerprint: None,
            patch_bytes: patch.len() as u64,
            status: "empty".into(),
            conflict: None,
        };
        if !patch.trim().is_empty() {
            match apply_patch(shared, &patch, true).await {
                Ok(()) => {
                    apply_patch(shared, &patch, false).await?;
                    merge.status = "applied".into();
                }
                Err(error) => {
                    merge.status = "conflict".into();
                    merge.conflict = Some(error.to_string());
                }
            }
        }
        let landed = merge.status != "conflict";
        if landed {
            let after = self.workflow_fingerprint(shared).await?;
            merge.target_fingerprint = Some(after.clone());
            w.current_fingerprint = Some(after.clone());
            // A review that read an earlier revision has not seen this, so it runs again.
            for step in w.steps.iter_mut().filter(|step| {
                !workflow_role_produces(&step.role) && step.input_revision.as_ref() != Some(&after)
            }) {
                if step.status == "completed" {
                    step.status = "pending".into();
                    step.input_revision = None;
                }
            }
            w.review_fingerprint = None;
            w.preview = None;
            w.checks.clear();
            if !w.joined.contains(&step.id) {
                w.joined.push(step.id.clone());
            }
        } else {
            w.error = Some(format!(
                "Step {:?} produced changes that conflict with this workflow's checkout. Nothing was applied; resolve it in the step's own worktree.",
                step.id
            ));
        }
        if let Some(step) = w.steps.iter_mut().find(|step| step.id == id) {
            step.merge = Some(merge);
        }
        Ok(())
    }

    async fn workflow_patch(&self, w: &AgentWorkflow, tree: &str) -> AppResult<String> {
        workflow_patch_between(Path::new(&w.root), &w.base_revision, tree).await
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
        if w.editing
            || w.awaiting_review()
            || w.stage != "ready"
            || !commands_passed(&w.check_commands, &w.checks)
            || w.checks
                .iter()
                .any(|c| Some(&c.fingerprint) != w.review_fingerprint.as_ref())
        {
            return Err(invalid(
                "Complete independent review and all recorded checks for the same revision first",
            ));
        }
        // Integration is unlocked by the review that read the finished result, not by whichever
        // review ran last: with work arriving from several steps, a review of one branch has not
        // seen what is about to be applied.
        let gating: Vec<&WorkflowStep> = w
            .steps
            .iter()
            .filter(|step| w.gates_integration(step))
            .collect();
        if gating.is_empty() {
            return Err(invalid("Independent review is missing"));
        }
        for step in &gating {
            if step.status != "completed" || step.input_revision != w.review_fingerprint {
                return Err(invalid(
                    "The independent review of the finished work has not completed for this revision",
                ));
            }
            let session = step
                .session_id
                .as_ref()
                .ok_or_else(|| invalid("Independent review is missing"))?;
            if self.session(session)?.status != "completed" {
                return Err(invalid("Independent review has not completed"));
            }
        }
        // Nothing may be integrated while a step's result is still sitting in its own checkout.
        if let Some(step) = w.unjoined().first() {
            return Err(invalid(format!(
                "Step {:?} has not been applied to this workflow's checkout yet",
                step.id
            )));
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
        // Every session this workflow's own steps opened belongs to it, not to a linked task.
        let own: Vec<&str> = w
            .steps
            .iter()
            .filter_map(|step| step.session_id.as_deref())
            .collect();
        if self.sessions().iter().any(|session| {
            !session.archived
                && session.id != w.implementation_session_id
                && Some(&session.id) != w.review_session_id.as_ref()
                && !own.contains(&session.id.as_str())
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
        // Every checkout this workflow opened is removed, not only the one results were applied to;
        // a step's own worktree is held to the same rules as the workflow's.
        let step_roots: Vec<String> = w
            .steps
            .iter()
            .filter_map(|step| step.root.clone())
            .collect();
        for step_root in step_roots {
            let step_root = match Path::new(&step_root).canonicalize() {
                Ok(path) => path,
                // A worktree the person already removed is not a reason to refuse.
                Err(_) => continue,
            };
            if !step_root.starts_with(self.home.join("worktrees").canonicalize()?) {
                return Err(invalid("This is not a RunHQ-managed worktree"));
            }
            let ignored = git_output(
                &step_root,
                &[
                    "ls-files",
                    "--others",
                    "--ignored",
                    "--exclude-standard",
                    "-z",
                ],
            )
            .await?;
            if ignored
                .split('\0')
                .filter(|path| !path.is_empty())
                .any(|path| {
                    !w.transferred_files
                        .iter()
                        .any(|copy| step_root.join(&copy.path) == step_root.join(path))
                })
            {
                return Err(invalid("A step's worktree contains ignored setup files (for example dependencies or local configuration). Remove or preserve them explicitly before cleanup."));
            }
            git_output(
                Path::new(&w.target),
                &[
                    "worktree",
                    "remove",
                    "--force",
                    &step_root.to_string_lossy(),
                ],
            )
            .await?;
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

/// Whether a declared division of labour can run at all, checked before anything is created.
///
/// A dependency may only name a step declared before it. That single rule makes a cycle impossible
/// to express and keeps the stored list in topological order, which every later decision — what may
/// start, what a step branches from, the order results are applied in — relies on.
fn validate_declared_graph(declared: &[CreateWorkflowStep]) -> AppResult<()> {
    if declared.is_empty() {
        return Ok(());
    }
    let ids = declared_step_ids(declared);
    let dependencies = declared_dependencies(declared, &ids);
    let mut seen: Vec<&str> = Vec::new();
    for (index, step) in declared.iter().enumerate() {
        if !WORKFLOW_ROLES.contains(&step.role.as_str()) {
            return Err(invalid(format!("Unsupported workflow role: {}", step.role)));
        }
        if step.target.trim().is_empty() {
            return Err(invalid("Every step needs an account or pool to run it"));
        }
        let id = ids[index].as_str();
        if !valid_step_id(id) {
            return Err(invalid(format!(
                "Step key {id:?} may use up to 32 lowercase letters, digits, dashes or underscores"
            )));
        }
        if seen.contains(&id) {
            return Err(invalid(format!("Two steps share the key {id:?}")));
        }
        seen.push(id);
        if step.prompt.len() > MAX_STEP_PROMPT {
            return Err(invalid(format!("The instruction for {id:?} is too long")));
        }
        if !matches!(
            step.review_policy.as_str(),
            "" | "continue" | "on_findings" | "approval" | "auto_fix"
        ) {
            return Err(invalid("Unknown review decision policy"));
        }
        if !matches!(step.workspace.trim(), "" | "shared" | "own") {
            return Err(invalid(format!(
                "Step {id:?} asks for an unknown checkout: {}",
                step.workspace
            )));
        }
        if step.workspace.trim() == "own" && !workflow_role_produces(&step.role) {
            return Err(invalid(format!(
                "Step {id:?} reads the work rather than producing it, so it runs in the checkout it reviews"
            )));
        }
        for dependency in &dependencies[index] {
            if !seen[..seen.len() - 1].contains(&dependency.as_str()) {
                return Err(invalid(format!(
                    "Step {id:?} depends on {dependency:?}, which is not a step declared before it"
                )));
            }
        }
    }
    // Ancestors, in declaration order, so "depends on everything that produces" is a set question.
    let mut ancestors: Vec<std::collections::BTreeSet<String>> = Vec::new();
    for declared_dependency in &dependencies {
        let mut reachable = std::collections::BTreeSet::new();
        for dependency in declared_dependency {
            reachable.insert(dependency.clone());
            if let Some(position) = ids.iter().position(|id| id == dependency) {
                reachable.extend(ancestors[position].iter().cloned());
            }
        }
        ancestors.push(reachable);
    }
    let producers: Vec<&String> = ids
        .iter()
        .zip(declared)
        .filter(|(_, step)| workflow_role_produces(&step.role))
        .map(|(id, _)| id)
        .collect();
    let mut continued = std::collections::BTreeSet::new();
    for (index, step) in declared.iter().enumerate() {
        if dependencies[index].is_empty() && !workflow_role_produces(&step.role) {
            return Err(invalid(format!(
                "Step {:?} reviews work that nothing has produced yet; every step that starts on its own must produce work",
                ids[index]
            )));
        }
        if let Some(previous_id) = &step.continue_from {
            let previous = ids
                .iter()
                .position(|id| id == previous_id)
                .map(|at| &declared[at]);
            if !workflow_role_produces(&step.role)
                || step.workspace.trim() == "own"
                || !ancestors[index].contains(previous_id)
                || !previous.is_some_and(|previous| {
                    workflow_role_produces(&previous.role)
                        && previous.workspace.trim() != "own"
                        && previous.target == step.target
                })
            {
                return Err(invalid(format!("Step {:?} must continue an earlier producing step on the same agent and shared working copy", ids[index])));
            }
            if !continued.insert(previous_id) {
                return Err(invalid("A conversation cannot fork into two continuations; chain the prompts or use separate conversations"));
            }
        }
        if !workflow_role_produces(&step.role)
            && !ancestors[index].iter().any(|id| producers.contains(&id))
        {
            return Err(invalid(format!(
                "Step {:?} has nothing to read; make it depend on a step that produces work",
                ids[index]
            )));
        }
    }
    // Integration is unlocked by a review that saw everything, so at least one review must run in
    // the shared checkout with every producing step behind it.
    let gating = declared.iter().enumerate().any(|(index, step)| {
        step.role == "review"
            && matches!(step.workspace.trim(), "" | "shared")
            && producers
                .iter()
                .all(|producer| ancestors[index].contains(*producer))
    });
    if !gating {
        return Err(invalid(
            "A workflow needs an independent review of the finished work: add a review in the shared checkout that depends on every step that produces",
        ));
    }
    Ok(())
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
pub(super) fn commands_passed(commands: &[String], evidence: &[WorkflowCheck]) -> bool {
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
/// The difference between two revisions of a checkout, as a patch.
///
/// A step's own result is the difference it made — `base` is what it started from, not the
/// workflow's base — so applying it elsewhere carries that step's work and nothing a sibling did.
async fn workflow_patch_between(root: &Path, base: &str, tree: &str) -> AppResult<String> {
    let tree = tree
        .split(':')
        .next()
        .ok_or_else(|| invalid("Invalid workspace fingerprint"))?;
    let patch = git_output(
        root,
        &["diff", "--binary", "--no-ext-diff", base, tree, "--"],
    )
    .await?;
    if patch.len() > PATCH_LIMIT {
        return Err(invalid("The change exceeds the 8 MiB integration preview limit; use the Git workspace to inspect and integrate it."));
    }
    Ok(patch)
}

/// RunHQ's own identity for the bookkeeping commits a step's result is recorded as. These are not
/// the person's commits — they are how a working tree becomes something another step can branch
/// from — so they do not borrow the person's name, and they never need their Git identity to be set.
const RUNHQ_COMMITTER: [&str; 4] = [
    "-c",
    "user.name=RunHQ",
    "-c",
    "user.email=runhq@runhq.invalid",
];

/// Record a tree as a commit, so a later step can branch from what this one produced.
///
/// A step's result is a working tree, and `git worktree add` can only start from a commit. The
/// commit is written into the repository's object store and pointed at by the step's own worktree
/// branch, so nothing collects it before the workflow is cleaned up.
async fn commit_tree(
    root: &Path,
    tree: &str,
    parents: &[String],
    message: &str,
) -> AppResult<String> {
    let tree = tree
        .split(':')
        .next()
        .ok_or_else(|| invalid("Invalid workspace fingerprint"))?;
    let mut args: Vec<String> = RUNHQ_COMMITTER.iter().map(|a| a.to_string()).collect();
    args.extend(["commit-tree".to_string(), tree.to_string()]);
    for parent in parents {
        args.push("-p".into());
        args.push(parent.clone());
    }
    args.push("-m".into());
    args.push(message.into());
    Ok(
        git_output(root, &args.iter().map(String::as_str).collect::<Vec<_>>())
            .await?
            .trim()
            .to_string(),
    )
}

/// Merge two commits in the object database, without a checkout.
///
/// Returns the merged tree, or the conflicted paths exactly as Git named them. A conflict is
/// reported and never resolved here: a step whose inputs disagree does not start.
async fn merge_trees(root: &Path, base: &str, other: &str) -> AppResult<Result<String, String>> {
    let mut command = Command::new("git");
    command
        .args(["merge-tree", "--write-tree", "--name-only", base, other])
        .kill_on_drop(true);
    crate::git::configure_git_cmd(command.as_std_mut(), root);
    let output = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .map_err(|_| invalid("Merging two parallel results timed out"))??;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(Ok(text.trim().to_string()));
    }
    // Git 2.38 introduced `--write-tree`; without it there is no way to merge without a checkout,
    // and saying so is better than silently running the steps one after another.
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.contains("unknown option") || stderr.contains("usage:") {
        return Err(invalid(
            "Merging results from steps that ran at the same time needs Git 2.38 or newer",
        ));
    }
    let conflicts: String = text.lines().skip(1).collect::<Vec<_>>().join("\n");
    Ok(Err(if conflicts.trim().is_empty() {
        stderr
    } else {
        conflicts
    }))
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
            || w.editing
            || w.awaiting_review()
            || w.start_after.is_some()
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
            w.launch_pending = false;
            w.auto_progress = false;
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
        // A stopped step is not still running, so it offers a retry rather than looking live —
        // every step that was running, because several may have been.
        for step in w.steps.iter_mut().filter(|step| step.status == "running") {
            step.status = "failed".into();
            step.finished_at = Some(now());
            step.error = Some("Stopped by you.".into());
        }
        // Anything that finishes after this belongs to a generation the workflow has left behind.
        w.generation += 1;
        w.launch_pending = false;
        w.auto_progress = false;
        w.start_after = None;
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

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    async fn launch_fixture(
        auto_progress: bool,
    ) -> (
        tempfile::TempDir,
        Arc<AgentManager>,
        AgentWorkflow,
        AgentSession,
    ) {
        let (temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Launch fixture".into(), repo).unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        std::fs::write(
            temp.path().join("bridge.cjs"),
            r#"
const fs = require('node:fs'), path = require('node:path');
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line); if (message.type !== 'start') return;
  const cfg = message.config;
  if (!cfg.read_only_review) fs.appendFileSync(path.join(cfg.cwd, 'README.md'), 'Queued change\n');
  process.stdout.write(JSON.stringify({type:'finished', status:'completed'}) + '\n');
  process.exit(0);
});
"#,
        )
        .unwrap();
        let preceding = manager
            .create(
                serde_json::from_value(json!({
                    "project_id": project.id, "backend": "codex", "title": "Already working"
                }))
                .unwrap(),
            )
            .await
            .unwrap();
        let preceding = manager
            .mutate(&preceding.id, |s, _| {
                s.status = "running".into();
                Ok(())
            })
            .unwrap();
        let workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id,
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Run these prompts".into(),
                base_ref: "HEAD".into(),
                setup_commands: vec!["echo setup > setup-ran".into()],
                check_commands: vec!["echo verified".into()],
                auto_progress,
                ..Default::default()
            })
            .await
            .unwrap();
        (temp, manager, workflow, preceding)
    }

    async fn wait_for_workflow(manager: &AgentManager, id: &str, stage: &str) -> AgentWorkflow {
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let w = manager.workflow(id).unwrap();
                if w.stage == stage {
                    return w;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("Expected {stage}, got {:?}", manager.workflow(id)))
    }

    #[tokio::test]
    async fn queued_launch_waits_for_success_before_setup_and_survives_leaving_the_ui() {
        for automatic in [false, true] {
            let (_temp, manager, workflow, preceding) = launch_fixture(automatic).await;
            let queued = manager
                .workflow_launch(&workflow.id, Some(preceding.id.clone()))
                .await
                .unwrap();
            assert_eq!(queued.stage, "waiting");
            assert_eq!(
                manager
                    .workflow(&workflow.id)
                    .unwrap()
                    .start_after
                    .unwrap()
                    .session_id,
                preceding.id
            );
            // Neither a manual start nor setup may skip the saved dependency.
            assert!(manager.workflow_run_step(&workflow.id).await.is_err());
            assert!(manager
                .workflow_run_named_step(&workflow.id, "implement")
                .await
                .is_err());
            assert!(manager.workflow_commands(&workflow.id, true).await.is_err());
            tokio::time::sleep(Duration::from_millis(60)).await;
            assert!(!Path::new(&workflow.cwd).join("setup-ran").exists());
            assert_eq!(
                manager
                    .session(&workflow.implementation_session_id)
                    .unwrap()
                    .status,
                "idle"
            );
            manager
                .mutate(&preceding.id, |s, _| {
                    s.status = "completed".into();
                    Ok(())
                })
                .unwrap();
            manager.workflow_notify();
            // No UI polling, schedule or start calls advance this run.
            let stage = if automatic { "ready" } else { "review_ready" };
            let done = if automatic {
                wait_for_workflow(&manager, &workflow.id, stage).await
            } else {
                // Manual progression stops after the first turn; reconciliation is read-only.
                tokio::time::timeout(Duration::from_secs(20), async {
                    loop {
                        let rows = manager.workflows().await.unwrap();
                        if let Some(w) = rows
                            .into_iter()
                            .find(|w| w.id == workflow.id && w.stage == stage)
                        {
                            break w;
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                })
                .await
                .unwrap()
            };
            assert!(!done.launch_pending);
            assert!(done.start_after.is_none());
            assert!(Path::new(&workflow.cwd).join("setup-ran").exists());
            assert_eq!(done.auto_progress, automatic);
            assert_ne!(done.cwd, preceding.cwd);
        }
    }

    #[tokio::test]
    async fn queued_launch_pauses_on_predecessor_failure_and_can_start_now_independently() {
        let (_temp, manager, workflow, preceding) = launch_fixture(true).await;
        manager
            .workflow_launch(&workflow.id, Some(preceding.id.clone()))
            .await
            .unwrap();
        manager
            .mutate(&preceding.id, |s, _| {
                s.status = "failed".into();
                Ok(())
            })
            .unwrap();
        manager.workflow_notify();
        let paused = wait_for_workflow(&manager, &workflow.id, "launch_failed").await;
        assert!(!paused.launch_pending && !paused.auto_progress);
        assert!(!Path::new(&workflow.cwd).join("setup-ran").exists());
        assert!(paused.error.unwrap().contains("preceding task"));
        // A person explicitly changes the timing; the failed task itself is never restarted.
        manager.workflow_launch(&workflow.id, None).await.unwrap();
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let w = manager.workflow(&workflow.id).unwrap();
                if w.steps[0].started_at.is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(manager.session(&preceding.id).unwrap().status, "failed");
        assert!(manager
            .workflow(&workflow.id)
            .unwrap()
            .start_after
            .is_none());
    }

    #[tokio::test]
    async fn immediate_launch_runs_without_waiting_for_other_project_tasks() {
        let (_temp, manager, workflow, preceding) = launch_fixture(true).await;
        let launched = manager.workflow_launch(&workflow.id, None).await.unwrap();
        assert_eq!(launched.stage, "launching");
        let ready = wait_for_workflow(&manager, &workflow.id, "ready").await;
        assert!(ready.start_after.is_none() && !ready.launch_pending);
        assert_eq!(manager.session(&preceding.id).unwrap().status, "running");
    }

    #[tokio::test]
    async fn queued_launch_cancellation_restart_and_project_boundaries_are_enforced() {
        for restart in [false, true] {
            let (_temp, manager, workflow, preceding) = launch_fixture(true).await;
            assert!(manager
                .workflow_launch(&workflow.id, Some("missing".into()))
                .await
                .is_err());
            assert!(manager
                .workflow_launch(
                    &workflow.id,
                    Some(workflow.implementation_session_id.clone())
                )
                .await
                .is_err());
            manager
                .mutate(&preceding.id, |s, _| {
                    s.project_id = "another-project".into();
                    Ok(())
                })
                .unwrap();
            assert!(manager
                .workflow_launch(&workflow.id, Some(preceding.id.clone()))
                .await
                .is_err());
            manager
                .mutate(&preceding.id, |s, _| {
                    s.project_id = workflow.project_id.clone();
                    Ok(())
                })
                .unwrap();
            manager
                .workflow_launch(&workflow.id, Some(preceding.id.clone()))
                .await
                .unwrap();
            if restart {
                manager.recover_workflows().unwrap();
            } else {
                manager.workflow_cancel(&workflow.id).await.unwrap();
            }
            assert_eq!(manager.session(&preceding.id).unwrap().status, "running");
            manager
                .mutate(&preceding.id, |s, _| {
                    s.status = "completed".into();
                    Ok(())
                })
                .unwrap();
            manager.workflow_notify();
            tokio::time::sleep(Duration::from_millis(60)).await;
            let paused = manager.workflow(&workflow.id).unwrap();
            assert!(!paused.launch_pending);
            assert_eq!(
                paused.stage,
                if restart {
                    "launch_paused"
                } else {
                    "cancelled"
                }
            );
            assert!(!Path::new(&workflow.cwd).join("setup-ran").exists());
        }
    }

    fn prompt_queue_steps(same_conversation: bool) -> Vec<CreateWorkflowStep> {
        [
            ("prompt1", "implement", "QUEUE_FIRST", None),
            ("review1", "review", "REVIEW_FIRST", Some("prompt1")),
            ("prompt2", "implement", "QUEUE_SECOND", Some("review1")),
            ("review2", "review", "REVIEW_SECOND", Some("prompt2")),
        ]
        .into_iter()
        .map(|(id, role, prompt, after)| CreateWorkflowStep {
            id: Some(id.into()),
            role: role.into(),
            target: "codex".into(),
            prompt: prompt.into(),
            depends_on: Some(after.into_iter().map(str::to_string).collect()),
            continue_from: (same_conversation && id == "prompt2").then(|| "prompt1".into()),
            ..Default::default()
        })
        .collect()
    }

    #[test]
    fn prompt_queue_continuation_requires_one_earlier_compatible_conversation() {
        assert!(validate_declared_graph(&prompt_queue_steps(true)).is_ok());
        assert!(validate_declared_graph(&prompt_queue_steps(false)).is_ok());
        for invalid_source in ["missing", "review1", "prompt2", "review2"] {
            let mut steps = prompt_queue_steps(true);
            steps[2].continue_from = Some(invalid_source.into());
            assert!(validate_declared_graph(&steps).is_err(), "{invalid_source}");
        }
        let mut steps = prompt_queue_steps(true);
        steps[2].target = "claude".into();
        assert!(validate_declared_graph(&steps).is_err());
        let mut steps = prompt_queue_steps(true);
        steps[0].workspace = "own".into();
        assert!(validate_declared_graph(&steps).is_err());
        let mut steps = prompt_queue_steps(true);
        steps[2].workspace = "own".into();
        assert!(validate_declared_graph(&steps).is_err());
        let mut steps = prompt_queue_steps(true);
        steps.push(CreateWorkflowStep {
            id: Some("fork".into()),
            role: "implement".into(),
            target: "codex".into(),
            depends_on: Some(vec!["prompt2".into()]),
            continue_from: Some("prompt1".into()),
            ..Default::default()
        });
        assert!(validate_declared_graph(&steps)
            .unwrap_err()
            .to_string()
            .contains("cannot fork"));
    }

    #[tokio::test]
    async fn prompt_queues_automatically_run_reviews_and_resume_the_selected_conversation() {
        assert!(
            super::super::executable("node").is_some(),
            "Node is required for the fixture agent"
        );
        for (same_conversation, next_model, next_effort) in [
            (false, "fixture-next", "low"),
            (true, "fixture-next", ""),
            (true, "", ""),
        ] {
            let (temp, manager, repo) = super::tests::repository();
            let project = manager.add_project("Queue fixture".into(), repo).unwrap();
            let mut tool = manager.tool("codex").unwrap();
            tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
            manager.save_tool(tool).unwrap();
            std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'), path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line); if (message.type !== 'start') return;
  const cfg = message.config;
  const stage = cfg.read_only_review
    ? (cfg.prompt.includes('REVIEW_SECOND') ? 'review2' : 'review1')
    : (cfg.prompt.includes('QUEUE_SECOND') ? 'prompt2' : 'prompt1');
  fs.appendFileSync(path.join(__dirname, 'queue-calls.jsonl'), JSON.stringify({ stage, native: cfg.native_id, review: cfg.read_only_review, prompt: cfg.prompt, model: cfg.model, effort: cfg.effort }) + '\n');
  emit({ type: 'native', id: cfg.native_id || `native-${stage}` });
  if (!cfg.read_only_review) fs.appendFileSync(path.join(cfg.cwd, 'README.md'), stage + '\n');
  emit({ type: 'item', item: { id: stage, kind: 'assistant', title: 'Result', text: cfg.read_only_review ? 'REVIEW_FINDINGS_SENTINEL' : 'Done', status: 'completed' } });
  emit({ type: 'finished', status: 'completed' });
  process.exit(0);
});
"#).unwrap();
            let mut steps = prompt_queue_steps(same_conversation);
            steps[0].model = "fixture-first".into();
            steps[0].effort = "high".into();
            steps[2].model = next_model.into();
            steps[2].effort = next_effort.into();
            for index in [1, 3] {
                steps[index].model = "fixture-review".into();
                steps[index].effort = "medium".into();
            }
            let workflow = manager
                .workflow_create(CreateAgentWorkflow {
                    project_id: project.id,
                    backend: "codex".into(),
                    reviewer_backend: "codex".into(),
                    objective: "Queued edits".into(),
                    base_ref: "HEAD".into(),
                    check_commands: vec!["echo verified".into()],
                    auto_progress: true,
                    steps,
                    ..Default::default()
                })
                .await
                .unwrap();
            manager.workflow_schedule(&workflow.id).await.unwrap();
            // Start once, as in the UI. Only automatic progression may advance subsequent steps.
            let ready = tokio::time::timeout(Duration::from_secs(30), async {
                loop {
                    let current = manager.workflow(&workflow.id).unwrap();
                    assert!(!current.stage.ends_with("failed"), "{:?}", current.error);
                    if current.stage == "ready" {
                        break current;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap_or_else(|_| {
                panic!("Queue did not finish: {:?}", manager.workflow(&workflow.id))
            });
            let calls: Vec<Value> = std::fs::read_to_string(temp.path().join("queue-calls.jsonl"))
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            assert_eq!(
                calls
                    .iter()
                    .map(|call| call["stage"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                ["prompt1", "review1", "prompt2", "review2"]
            );
            assert_eq!(
                calls[2]["native"].as_str(),
                same_conversation.then_some("native-prompt1")
            );
            for (index, model, effort) in [
                (0, "fixture-first", "high"),
                (1, "fixture-review", "medium"),
                (2, next_model, next_effort),
                (3, "fixture-review", "medium"),
            ] {
                assert_eq!(calls[index]["model"].as_str().unwrap_or_default(), model);
                assert_eq!(calls[index]["effort"].as_str().unwrap_or_default(), effort);
            }
            assert!(
                calls[1]["native"].is_null() && calls[3]["native"].is_null(),
                "reviews must start independent conversations"
            );
            assert!(calls[2]["prompt"]
                .as_str()
                .unwrap()
                .contains("REVIEW_FINDINGS_SENTINEL"));
            let first = ready.step("prompt1").unwrap().session_id.as_ref().unwrap();
            let second = ready.step("prompt2").unwrap().session_id.as_ref().unwrap();
            assert_eq!(first == second, same_conversation);
            assert_ne!(
                ready.step("review1").unwrap().session_id.as_ref(),
                Some(first)
            );
            let snapshot = manager.snapshot(second, None).unwrap();
            assert_eq!(
                snapshot
                    .items
                    .iter()
                    .filter(|item| item.kind == "user")
                    .count(),
                if same_conversation { 2 } else { 1 }
            );
            assert_eq!(ready.checks[0].status, "passed");
            assert!(
                !std::fs::read_to_string(Path::new(&ready.target).join("README.md"))
                    .unwrap()
                    .contains("prompt2")
            );
        }
    }

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
            ..Default::default()
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
                ..Default::default()
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
                                // The bridge reads `value.decision` and checks it against the
                                // options the agent offered, so a bare string is refused.
                                let answer = serde_json::json!({
                                    "decision": value.unwrap_or(serde_json::json!("allow"))
                                });
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
            ..Default::default()
        };
        let step = |role: &str, target: &str, model: &str| CreateWorkflowStep {
            role: role.into(),
            target: target.into(),
            model: model.into(),
            effort: String::new(),
            mode: String::new(),
            ..Default::default()
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
        // A list that declares no dependencies is still the chain it always was, now said in the
        // words a graph uses.
        let declared: Vec<&[String]> = workflow
            .steps
            .iter()
            .map(|step| step.depends_on.as_slice())
            .collect();
        assert_eq!(declared[0], Vec::<String>::new());
        assert_eq!(declared[1], ["plan-1".to_string()]);
        assert_eq!(declared[2], ["implement-2".to_string()]);
        assert!(
            workflow.steps.iter().all(|step| step.workspace == "shared"
                && step.prompt.is_empty()
                && step.cwd.is_none()),
            "a step that asked for nothing of its own runs in the workflow's checkout"
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

    /// Several tasks, each with its own instruction, and only the order the dependencies state.
    #[tokio::test]
    async fn a_declared_graph_keeps_its_tasks_dependencies_and_own_checkouts() {
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
            reviewer_backend: "codex".into(),
            objective: "Ship the ordering flow".into(),
            base_ref: "HEAD".into(),
            check_commands: vec!["echo verified".into()],
            steps,
            ..Default::default()
        };
        let task = |id: &str, role: &str, prompt: &str, after: &[&str], workspace: &str| {
            CreateWorkflowStep {
                id: Some(id.into()),
                role: role.into(),
                target: if workflow_role_produces(role) {
                    "codex".into()
                } else {
                    "claude".into()
                },
                prompt: prompt.into(),
                depends_on: Some(after.iter().map(|id| (*id).to_string()).collect()),
                workspace: workspace.into(),
                ..Default::default()
            }
        };
        // api → {ui, docs} → rev: the two middle tasks wait on the same thing and on nothing of
        // each other, so they are free to run at the same time — each in a checkout of its own.
        let workflow = manager
            .workflow_create(create(vec![
                task("api", "implement", "Add POST /orders", &[], ""),
                task("ui", "implement", "Build the order form", &["api"], "own"),
                task(
                    "docs",
                    "implement",
                    "Document the endpoint",
                    &["api"],
                    "own",
                ),
                task("rev", "review", "Review everything", &["ui", "docs"], ""),
            ]))
            .await
            .unwrap();
        let shape: Vec<(&str, Vec<&str>, &str, &str)> = workflow
            .steps
            .iter()
            .map(|step| {
                (
                    step.id.as_str(),
                    step.depends_on.iter().map(String::as_str).collect(),
                    step.workspace.as_str(),
                    step.prompt.as_str(),
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                ("api", vec![], "shared", "Add POST /orders"),
                ("ui", vec!["api"], "own", "Build the order form"),
                ("docs", vec!["api"], "own", "Document the endpoint"),
                ("rev", vec!["ui", "docs"], "shared", "Review everything"),
            ],
            "each task keeps the key, instruction, dependencies and checkout it declared"
        );
        // A reader that predates the graph still sees a chain it can follow.
        assert_eq!(
            workflow.step("rev").unwrap().input_step_id.as_deref(),
            Some("ui")
        );

        // Shapes a graph makes expressible but that still cannot run are refused before anything is
        // created, so an unusable division of labour never opens a checkout.
        for (steps, expected) in [
            (
                vec![
                    task("api", "implement", "x", &[], ""),
                    task("rev", "review", "x", &["missing"], ""),
                ],
                "is not a step declared before it",
            ),
            (
                vec![
                    task("api", "implement", "x", &["rev"], ""),
                    task("rev", "review", "x", &["api"], ""),
                ],
                "is not a step declared before it",
            ),
            (
                vec![
                    task("api", "implement", "x", &[], ""),
                    task("api", "review", "x", &["api"], ""),
                ],
                "share the key",
            ),
            (
                vec![
                    task("API key", "implement", "x", &[], ""),
                    task("rev", "review", "x", &["API key"], ""),
                ],
                "lowercase letters",
            ),
            (
                vec![
                    task("api", "implement", "x", &[], ""),
                    task("ui", "implement", "x", &["api"], "own"),
                    task("rev", "review", "x", &["api"], ""),
                ],
                "depends on every step that produces",
            ),
            (
                vec![
                    task("api", "implement", "x", &[], ""),
                    task("rev", "review", "x", &["api"], "own"),
                ],
                "runs in the checkout it reviews",
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
                ..Default::default()
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
        // The fixture arrives reviewed; this walk starts it over, so the steps say so too.
        for step in &mut workflow.steps {
            step.status = "pending".into();
            step.input_revision = None;
        }
        workflow.review_fingerprint = None;
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
    #[tokio::test]
    async fn a_failed_named_step_can_be_explicitly_retried() {
        if super::super::executable("node").is_none() {
            return;
        }
        let (temp, manager, mut workflow) = prepared().await;
        std::fs::write(
            temp.path().join("bridge.cjs"),
            r#"
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
 if(JSON.parse(line).type!=='start') return;
 process.stdout.write(JSON.stringify({type:'finished',status:'completed'})+'\n'); process.exit(0);
});
"#,
        )
        .unwrap();
        workflow.steps[0].status = "failed".into();
        workflow.steps[1].status = "pending".into();
        workflow.stage = "implementation_failed".into();
        manager.save_workflow(&mut workflow).unwrap();
        let retried = manager
            .workflow_run_named_step(&workflow.id, &workflow.steps[0].id)
            .await
            .unwrap();
        assert_eq!(retried.steps[0].status, "running");
        tokio::time::timeout(Duration::from_secs(10), async {
            while manager
                .session(&retried.implementation_session_id)
                .unwrap()
                .active()
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            manager
                .session(&retried.implementation_session_id)
                .unwrap()
                .status,
            "completed"
        );
    }

    #[tokio::test]
    async fn a_completed_shared_step_updates_the_join_baseline() {
        let (_temp, manager, mut workflow) = prepared().await;
        let before = workflow.current_fingerprint.clone();
        workflow.steps[0].status = "running".into();
        workflow.steps[1].status = "pending".into();
        workflow.stage = "implementing".into();
        std::fs::write(
            Path::new(&workflow.cwd).join("README.md"),
            "shared step result\n",
        )
        .unwrap();
        manager.reconcile_workflow(&mut workflow).await.unwrap();
        assert_eq!(workflow.steps[0].status, "completed");
        assert_ne!(workflow.current_fingerprint, before);
        assert_eq!(
            workflow.current_fingerprint,
            Some(
                manager
                    .workflow_fingerprint(Path::new(&workflow.root))
                    .await
                    .unwrap()
            )
        );
    }

    #[tokio::test]
    async fn pool_scheduling_respects_cooldown_capabilities_load_and_global_capacity() {
        let (_temp, manager, mut workflow) = prepared().await;
        let mut alternate = manager.tool("codex").unwrap();
        alternate.id = "alternate".into();
        alternate.name = "Alternate".into();
        manager.save_tool(alternate.clone()).unwrap();
        manager
            .workspace_save(
                "pool:workers".into(),
                Some(json!({
                    "accounts": ["codex", "alternate"]
                })),
            )
            .unwrap();
        manager
            .workspace_save(
                "preferences:capacity".into(),
                Some(json!({
                    "global": 8, "providers": {"codex": 1, "alternate": 2}
                })),
            )
            .unwrap();
        assert_eq!(
            manager.resolve_step_target("pool:workers", false).unwrap(),
            "alternate"
        );
        manager
            .workspace_save(
                "preferences:cooldowns".into(),
                Some(json!({
                    "alternate": {"since": now(), "until": now() + 60_000, "reason": "rate limit"}
                })),
            )
            .unwrap();
        assert_eq!(
            manager.resolve_step_target("pool:workers", false).unwrap(),
            "codex"
        );
        manager
            .workspace_save("preferences:cooldowns".into(), None)
            .unwrap();
        alternate.adapter = "terminal".into();
        manager.save_tool(alternate).unwrap();
        assert_eq!(
            manager.resolve_step_target("pool:workers", true).unwrap(),
            "codex"
        );

        let mut step = workflow.steps[0].clone();
        step.target = "pool:workers".into();
        step.status = "pending".into();
        step.session_id = None;
        step.workspace = "own".into();
        workflow.steps = vec![step.clone()];
        // A bounded thread catches a reentrant parking_lot lock without hanging the test process.
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = Arc::clone(&manager);
        let copy = workflow.clone();
        std::thread::spawn(move || {
            sender
                .send(worker.workflow_step_wait(&copy, &copy.steps[0], &[]))
                .unwrap()
        });
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            StepWait::Ready
        );
        manager
            .workspace_save("preferences:capacity".into(), Some(json!({"global": 1})))
            .unwrap();
        let (sender, _receiver) = mpsc::channel(1);
        manager.state.lock().running.insert(
            workflow.implementation_session_id.clone(),
            Running {
                run_id: "occupied".into(),
                cwd: PathBuf::from(&workflow.cwd),
                sender,
            },
        );
        assert_eq!(
            manager.workflow_step_wait(&workflow, &step, &[]),
            StepWait::Capacity
        );
        assert!(manager
            .resolve_step_target("pool:workers", false)
            .unwrap_err()
            .to_string()
            .contains("global execution slot"));
        manager.state.lock().running.clear();
    }

    #[tokio::test]
    async fn automatic_scheduler_starts_a_newly_unblocked_task_while_its_sibling_runs() {
        if super::super::executable("node").is_none() {
            return;
        }
        let (temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Example".into(), repo).unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        manager
            .workspace_save("pool:workers".into(), Some(json!({"accounts": ["codex"]})))
            .unwrap();
        manager
            .workspace_save("preferences:capacity".into(), Some(json!({"global": 2})))
            .unwrap();
        std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs=require('node:fs'), path=require('node:path');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
  const message=JSON.parse(line); if(message.type!=='start') return;
  const cfg=message.config, named=/write ([a-z.]+)/.exec(cfg.prompt||'');
  if(!cfg.read_only_review && named) fs.writeFileSync(path.join(cfg.cwd,named[1]),'done\n');
  const finish=()=>{emit({type:'finished',status:'completed'});process.exit(0);};
  if(named && named[1]==='a.txt') {
    const timer=setInterval(()=>{if(fs.existsSync(path.join(__dirname,'release-a'))) {clearInterval(timer);finish();}},30);
  } else setTimeout(finish,50);
});
"#).unwrap();
        let task =
            |id: &str, role: &str, prompt: &str, after: &[&str], own: bool| CreateWorkflowStep {
                id: Some(id.into()),
                role: role.into(),
                prompt: prompt.into(),
                target: if own { "pool:workers" } else { "codex" }.into(),
                depends_on: Some(after.iter().map(|id| (*id).to_string()).collect()),
                workspace: if own { "own" } else { "shared" }.into(),
                ..Default::default()
            };
        let workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id,
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Schedule newly unblocked work".into(),
                base_ref: "HEAD".into(),
                check_commands: vec!["echo verified".into()],
                auto_progress: true,
                steps: vec![
                    task("a", "implement", "write a.txt", &[], true),
                    task("b", "implement", "write b.txt", &[], true),
                    task("c", "implement", "write c.txt", &["b"], true),
                    task("review", "review", "review all work", &["a", "c"], false),
                ],
                ..Default::default()
            })
            .await
            .unwrap();
        manager.workflow_schedule(&workflow.id).await.unwrap();
        // Do not call schedule here: this must prove the automatic loop fills the free slot.
        let unblocked = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let current = manager.workflow(&workflow.id).unwrap();
                if current.step("c").unwrap().status == "completed" {
                    break current;
                }
                assert!(!current.stage.ends_with("failed"), "{:?}", current.error);
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(unblocked.step("a").unwrap().status, "running");
        std::fs::write(temp.path().join("release-a"), "continue").unwrap();
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
        assert_eq!(ready.checks[0].status, "passed");
        assert!(!Path::new(&ready.target).join("c.txt").exists());
    }

    /// Two tasks that wait on nothing of each other run at the same time, in checkouts of their
    /// own, and their results are applied to the workflow's checkout in the order declared.
    #[tokio::test]
    async fn independent_tasks_run_at_once_and_their_results_are_applied_in_order() {
        if super::super::executable("node").is_none() {
            return;
        }
        let (temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Example".into(), repo).unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        // Producers report that they started and wait on an explicit release barrier. This
        // proves overlap even when creating the second checkout is slow, as on Windows CI.
        std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'); const path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message=JSON.parse(line); if(message.type!=='start') return;
  const cfg=message.config;
  fs.appendFileSync(path.join(__dirname,'calls.jsonl'), JSON.stringify({cwd:cfg.cwd,review:cfg.read_only_review})+'\n');
  const named = /write ([a-z.]+)/.exec(cfg.prompt || '');
  if(!cfg.read_only_review && named) fs.writeFileSync(path.join(cfg.cwd,named[1]),'done\n');
  emit({type:'item',item:{id:'result',kind:'assistant',title:'Agent',text:'ok',status:'completed'}});
  const finish=()=>{emit({type:'finished',status:'completed'});process.exit(0);};
  if(!cfg.read_only_review && named) {
    fs.writeFileSync(path.join(__dirname,named[1]+'.started'),'started');
    const timer=setInterval(()=>{
      if(fs.existsSync(path.join(__dirname,'release-'+named[1]))) {clearInterval(timer);finish();}
    },10);
  } else finish();
});
"#).unwrap();
        let task = |id: &str, role: &str, prompt: &str, after: &[&str], workspace: &str| {
            CreateWorkflowStep {
                id: Some(id.into()),
                role: role.into(),
                target: "codex".into(),
                prompt: prompt.into(),
                depends_on: Some(after.iter().map(|id| (*id).to_string()).collect()),
                workspace: workspace.into(),
                ..Default::default()
            }
        };
        let workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id.clone(),
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Two independent tasks".into(),
                base_ref: "HEAD".into(),
                check_commands: vec![r#"node -e "require('node:fs').accessSync('api.txt');require('node:fs').accessSync('docs.txt')""#.into()],
                auto_progress: true,
                steps: vec![
                    task("api", "implement", "write api.txt", &[], "own"),
                    task("docs", "implement", "write docs.txt", &[], "own"),
                    task("rev", "review", "review it", &["api", "docs"], ""),
                ],
                ..Default::default()
            })
            .await
            .unwrap();
        manager.workflow_schedule(&workflow.id).await.unwrap();
        // Wait for evidence from both processes; elapsed time is not evidence of overlap.
        tokio::time::timeout(Duration::from_secs(60), async {
            while !["api.txt.started", "docs.txt.started"]
                .iter()
                .all(|name| temp.path().join(name).is_file())
            {
                let current = manager.workflow(&workflow.id).unwrap();
                assert!(!current.stage.ends_with("failed"), "{:?}", current.error);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        // Both producing tasks are free from the start, so both are running — which one checkout
        // could never allow.
        let running = manager.workflow(&workflow.id).unwrap();
        let live: Vec<&str> = running
            .steps
            .iter()
            .filter(|step| step.status == "running")
            .map(|step| step.id.as_str())
            .collect();
        assert_eq!(live, ["api", "docs"], "{:?}", running.error);
        let roots: Vec<&str> = running
            .steps
            .iter()
            .filter_map(|step| step.root.as_deref())
            .collect();
        assert_eq!(roots.len(), 2);
        assert_ne!(
            roots[0], roots[1],
            "each task works in a checkout of its own"
        );
        assert!(roots.iter().all(|root| *root != running.root));
        for step in running.steps.iter().filter(|step| step.status == "running") {
            assert!(manager
                .session(step.session_id.as_ref().unwrap())
                .unwrap()
                .active());
        }
        std::fs::write(temp.path().join("release-api.txt"), "continue").unwrap();
        // Release the first result before the second so ordering is observed from persisted
        // completion, not assumed from process startup or wall-clock delays.
        tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let current = manager.workflow(&workflow.id).unwrap();
                if current.joined == ["api"] {
                    break;
                }
                assert!(!current.stage.ends_with("failed"), "{:?}", current.error);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        std::fs::write(temp.path().join("release-docs.txt"), "continue").unwrap();

        let ready = tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                // Automatic progression is the only driver. A manual check could race the
                // scheduler after observing checks_ready and correctly be rejected as concurrent.
                let current = manager.workflow(&workflow.id).unwrap();
                if current.stage == "ready" {
                    break current;
                }
                assert!(
                    !current.stage.ends_with("failed"),
                    "{} {:?}",
                    current.stage,
                    current.error
                );
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();
        // Both results were applied to the workflow's own checkout, in the order declared.
        assert_eq!(ready.joined, ["api", "docs"]);
        for name in ["api.txt", "docs.txt"] {
            assert!(
                Path::new(&ready.cwd).join(name).is_file(),
                "{name} was not applied"
            );
        }
        assert!(ready
            .steps
            .iter()
            .filter(|step| step.owns_workspace())
            .all(|step| step.merge.as_ref().unwrap().status == "applied"));
        // The review read the finished result, and the checks ran against exactly that.
        let review = ready.step("rev").unwrap();
        assert_eq!(review.input_revision, ready.review_fingerprint);
        assert_eq!(ready.checks[0].status, "passed");
        // Nothing reached the project itself; applying stays an explicit choice.
        assert!(!Path::new(&ready.target).join("api.txt").exists());
    }

    /// Two parallel results that touch the same line are reported, not merged behind the person.
    #[tokio::test]
    async fn conflicting_parallel_results_are_reported_and_never_resolved_automatically() {
        if super::super::executable("node").is_none() {
            return;
        }
        let (temp, manager, repo) = super::tests::repository();
        let project = manager.add_project("Example".into(), repo).unwrap();
        let mut tool = manager.tool("codex").unwrap();
        tool.executable = std::env::current_exe().unwrap().to_string_lossy().into();
        manager.save_tool(tool).unwrap();
        std::fs::write(temp.path().join("bridge.cjs"), r#"
const fs = require('node:fs'); const path = require('node:path');
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message=JSON.parse(line); if(message.type!=='start') return;
  const cfg=message.config;
  const named = /write README as ([a-z]+)/.exec(cfg.prompt || '');
  if(!cfg.read_only_review && named) fs.writeFileSync(path.join(cfg.cwd,'README.md'),named[1]+'\n');
  emit({type:'item',item:{id:'result',kind:'assistant',title:'Agent',text:'ok',status:'completed'}});
  setTimeout(()=>{emit({type:'finished',status:'completed'});process.exit(0);},60);
});
"#).unwrap();
        let task = |id: &str, role: &str, prompt: &str, after: &[&str], workspace: &str| {
            CreateWorkflowStep {
                id: Some(id.into()),
                role: role.into(),
                target: "codex".into(),
                prompt: prompt.into(),
                depends_on: Some(after.iter().map(|id| (*id).to_string()).collect()),
                workspace: workspace.into(),
                ..Default::default()
            }
        };
        let workflow = manager
            .workflow_create(CreateAgentWorkflow {
                project_id: project.id.clone(),
                backend: "codex".into(),
                reviewer_backend: "codex".into(),
                objective: "Two tasks that disagree".into(),
                base_ref: "HEAD".into(),
                check_commands: vec!["echo verified".into()],
                steps: vec![
                    task("left", "implement", "write README as left", &[], "own"),
                    task("right", "implement", "write README as right", &[], "own"),
                    task("rev", "review", "review it", &["left", "right"], ""),
                ],
                ..Default::default()
            })
            .await
            .unwrap();
        let conflicted = tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                manager.workflow_schedule(&workflow.id).await.unwrap();
                let current = manager.workflow(&workflow.id).unwrap();
                if current.steps.iter().any(|step| {
                    step.merge
                        .as_ref()
                        .is_some_and(|merge| merge.status == "conflict")
                }) {
                    break current;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();
        // The first result landed; the second is held with the paths Git named, and the shared
        // checkout still reads as the first result rather than as a half-merged mixture.
        assert_eq!(conflicted.joined, ["left"]);
        let held = conflicted.step("right").unwrap().merge.as_ref().unwrap();
        assert_eq!(held.status, "conflict");
        assert!(held.conflict.as_ref().is_some_and(|text| !text.is_empty()));
        assert_eq!(
            std::fs::read_to_string(Path::new(&conflicted.cwd).join("README.md")).unwrap(),
            "left\n"
        );
        // Nothing can be validated or integrated while a result is still held back.
        assert!(!conflicted.unjoined().is_empty());
        assert!(manager.workflow_preview(&workflow.id).await.is_err());
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
                ..Default::default()
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
        workflow.review_session_id = Some(reviewer.id.clone());
        workflow.review_fingerprint = Some(
            manager
                .workflow_fingerprint(Path::new(&workflow.root))
                .await
                .unwrap(),
        );
        workflow.current_fingerprint = workflow.review_fingerprint.clone();
        // The stage a workflow is in follows from its steps, so a fixture that stands for "reviewed,
        // waiting on checks" has to say so in the steps themselves rather than only in the stage.
        for step in &mut workflow.steps {
            step.status = "completed".into();
            if workflow_role_produces(&step.role) {
                step.input_revision = Some(workflow.base_revision.clone());
            } else {
                step.session_id = Some(reviewer.id.clone());
                step.input_revision = workflow.review_fingerprint.clone();
            }
        }
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
            || workflow.steps.iter().any(|step| step.status == "running")
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
        // A workflow owns its shared checkout and one per step that asked for its own, so the
        // inventory names every one of them against the workflow rather than as a loose worktree.
        let mut seen: std::collections::HashSet<PathBuf> = workflows
            .iter()
            .flat_map(|w| {
                std::iter::once(PathBuf::from(&w.root)).chain(
                    w.steps
                        .iter()
                        .filter_map(|step| step.root.clone().map(PathBuf::from)),
                )
            })
            .collect();
        let checkouts: Vec<(AgentWorkflow, String, String, String)> = workflows
            .into_iter()
            .filter(|w| !w.cleaned)
            .flat_map(|w| {
                let mut entries = vec![(
                    w.clone(),
                    w.root.clone(),
                    w.implementation_session_id.clone(),
                    w.base_revision.clone(),
                )];
                for step in &w.steps {
                    if let (Some(root), Some(session)) = (&step.root, &step.session_id) {
                        entries.push((
                            w.clone(),
                            root.clone(),
                            session.clone(),
                            step.input_revision
                                .clone()
                                .unwrap_or_else(|| w.base_revision.clone()),
                        ));
                    }
                }
                entries
            })
            .collect();
        for (workflow, checkout, session_id, base_revision) in checkouts {
            let root = PathBuf::from(&checkout);
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
                project_id: workflow.project_id,
                path: checkout,
                branch: self.session(&session_id).ok().and_then(|s| s.branch),
                session_id,
                base_revision,
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
