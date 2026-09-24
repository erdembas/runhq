use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub package: Option<PackageMetadata>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub semantics: Vec<String>,
    pub settings: Settings,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub assets: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub paths_relative_to: String,
    pub agent_working_directory: String,
    pub shell_working_directory: String,
    pub agent_mode: String,
    pub agent_permissions: Vec<String>,
    pub agent_timeout_minutes: u32,
    pub shell_timeout_minutes: u32,
    pub locks: BTreeMap<String, Lock>,
    pub max_concurrent_unlocked_steps: u32,
    pub review: ReviewSettings,
    pub failure_policy: FailurePolicy,
    pub repositories: Vec<Repository>,
    pub result_line: Option<ResultLine>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            paths_relative_to: "pipelineFile".into(),
            agent_working_directory: String::new(),
            shell_working_directory: ".".into(),
            agent_mode: "agent".into(),
            agent_permissions: vec!["read".into(), "write".into(), "terminal".into()],
            agent_timeout_minutes: 240,
            shell_timeout_minutes: 30,
            locks: BTreeMap::new(),
            max_concurrent_unlocked_steps: 2,
            review: ReviewSettings::default(),
            failure_policy: FailurePolicy::default(),
            repositories: vec![],
            result_line: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lock {
    pub max_concurrent: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReviewSettings {
    pub max_reviews_per_plan: u32,
    pub max_fixes_per_plan: u32,
    pub accept_conditional_from_review: u32,
    pub strict_plans: Vec<String>,
}
impl Default for ReviewSettings {
    fn default() -> Self {
        Self {
            max_reviews_per_plan: 3,
            max_fixes_per_plan: 2,
            accept_conditional_from_review: 0,
            strict_plans: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct FailurePolicy {
    pub on_missing_or_ambiguous_result_line: String,
    pub on_halt: String,
    pub running_steps_on_halt: String,
    pub notify_human: bool,
    pub resume: String,
}
impl Default for FailurePolicy {
    fn default() -> Self {
        Self {
            on_missing_or_ambiguous_result_line: "treatAsFailed".into(),
            on_halt: "stopStartingNewSteps".into(),
            running_steps_on_halt: "letFinish".into(),
            notify_human: true,
            resume: "rerunHaltedStep".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Repository {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub branch: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Step {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub description: String,
    pub depends_on: Vec<String>,
    pub lock: String,
    pub prompt_file: String,
    pub prompt: String,
    pub command: String,
    pub message: String,
    pub model: String,
    pub effort: String,
    pub mode: String,
    pub backend: String,
    pub timeout_minutes: Option<u32>,
    pub success: Option<Matcher>,
    pub halt_if: Option<Halt>,
    pub capture: Option<Capture>,
    pub run_if: String,
    pub complete_if: String,
    pub max_runs: u32,
    pub on_success: Option<Rerun>,
    /// Native alternative to string expressions: the barrier requires PASS from these reviews.
    pub require_pass: Vec<String>,
}
impl Default for Step {
    fn default() -> Self {
        Self {
            id: String::new(),
            r#type: String::new(),
            title: String::new(),
            description: String::new(),
            depends_on: vec![],
            lock: String::new(),
            prompt_file: String::new(),
            prompt: String::new(),
            command: String::new(),
            message: String::new(),
            model: String::new(),
            effort: String::new(),
            mode: String::new(),
            backend: String::new(),
            timeout_minutes: None,
            success: None,
            halt_if: None,
            capture: None,
            run_if: String::new(),
            complete_if: String::new(),
            max_runs: 1,
            on_success: None,
            require_pass: vec![],
        }
    }
}
impl Step {
    pub fn review(&self) -> bool {
        self.capture.is_some()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
#[derive(Default)]
pub struct Matcher {
    pub output_regex: Option<String>,
    pub last_line_regex: Option<String>,
    pub exit_code: Option<i32>,
    pub exit_code_not: Option<i32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Halt {
    Match(Matcher),
    Expression(String),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capture {
    pub verdict: VerdictCapture,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rerun {
    pub rerun: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineIssue {
    pub code: String,
    pub detail: String,
    pub blocking: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineRun {
    pub id: String,
    pub manifest: Manifest,
    pub package_root: String,
    pub run_root: String,
    pub repositories: Vec<Repository>,
    pub issues: Vec<PipelineIssue>,
    pub state: String,
    pub revision: u64,
    pub backend: String,
    pub reviewer: String,
    #[serde(default)]
    pub project_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub steps: BTreeMap<String, StepState>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct StepState {
    pub status: String,
    pub runs: u32,
    pub verdict: Option<String>,
    pub attempts: Vec<Attempt>,
    pub approved_at: Option<i64>,
    pub error: Option<String>,
    pub revisions: BTreeMap<String, String>,
    pub extra_runs_approved_at: Vec<i64>,
}
impl Default for StepState {
    fn default() -> Self {
        Self {
            status: "pending".into(),
            runs: 0,
            verdict: None,
            attempts: vec![],
            approved_at: None,
            error: None,
            revisions: BTreeMap::new(),
            extra_runs_approved_at: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attempt {
    pub id: String,
    pub round: u32,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub session_id: Option<String>,
    pub exit_code: Option<i32>,
    pub output: String,
    pub outcome: String,
    pub snapshot_root: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineSummary {
    pub id: String,
    pub name: String,
    pub state: String,
    pub revision: u64,
    pub total: usize,
    pub completed: usize,
    pub issue_count: usize,
    pub attention: String,
    pub project_id: String,
    pub notify_human: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageMetadata {
    #[serde(default)]
    pub self_contained: bool,
    #[serde(default)]
    pub install: Vec<String>,
    pub contents: Vec<String>,
    #[serde(default)]
    pub runtime_directory: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultLine {
    pub position: String,
    pub trim_trailing_whitespace: bool,
    pub agent_steps: String,
    pub review_steps: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VerdictCapture {
    Output(String),
    LastLine(LastLineCapture),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastLineCapture {
    pub last_line_regex: String,
    pub group: usize,
}
impl VerdictCapture {
    pub fn pattern(&self) -> &str {
        match self {
            Self::Output(p) => p,
            Self::LastLine(c) => &c.last_line_regex,
        }
    }
    pub fn last_line(&self) -> bool {
        matches!(self, Self::LastLine(_))
    }
}
