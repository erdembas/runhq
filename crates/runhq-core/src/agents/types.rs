use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProject {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequest {
    pub id: String,
    #[serde(default)]
    pub native_id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub questions: Value,
    #[serde(default)]
    pub choices: Value,
    #[serde(default)]
    pub schema: Value,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub text: String,
    pub status: String,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub cwd: String,
    pub backend: String,
    pub executable: String,
    #[serde(default)]
    pub adapter: String,
    #[serde(default)]
    pub backend_name: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Snapshot of the connection environment taken when the session was created. A later edit to
    /// the tool must not move a live conversation to another account, because provider-native
    /// resume belongs to the account that opened it.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub title: String,
    pub model: String,
    pub effort: String,
    pub mode: String,
    pub agent: String,
    pub native_id: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub revision: u64,
    pub archived: bool,
    pub unread: bool,
    pub last_error: Option<String>,
    pub isolated: bool,
    pub branch: Option<String>,
    pub usage: Value,
    /// Locally measured turn timing. Providers report tokens, not duration, so these are RunHQ's own
    /// clock: when the active turn started, how long the last completed turn took, and the total
    /// across completed turns. A turn interrupted by a crash is not counted, because its real end is
    /// unknown and a guess would read as measurement.
    /// The commit the checkout was on when this task was created, and the tracked files that were
    /// already modified at that moment. Recorded so **Changes** can say which edits predate the
    /// task instead of presenting the whole working tree as the agent's work.
    #[serde(default)]
    pub base_revision: Option<String>,
    #[serde(default)]
    pub pre_existing_paths: Vec<String>,
    #[serde(default)]
    pub turn_started_at: Option<i64>,
    #[serde(default)]
    pub last_turn_ms: Option<i64>,
    #[serde(default)]
    pub total_run_ms: i64,
    #[serde(default)]
    pub runtime_state: Value,
    #[serde(default)]
    pub workflow_read_only: bool,
    pub pending: Vec<AgentRequest>,
}

impl AgentSession {
    pub fn active(&self) -> bool {
        matches!(
            self.status.as_str(),
            "starting" | "running" | "waiting_input" | "waiting_permission" | "cancelling"
        )
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentSnapshot {
    pub session: AgentSession,
    pub items: Vec<AgentItem>,
    pub before: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentBackend {
    pub id: String,
    pub name: String,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub available: bool,
    pub error: Option<String>,
    pub adapter: String,
    pub enabled: bool,
    pub command: String,
    pub args: Vec<String>,
    /// Carried so the tools screen can edit or toggle a connection without dropping the account it
    /// points at.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub detection_status: AgentDetectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detection_source: Option<AgentDetectionSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentDetectionStatus {
    Available,
    NotFound,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentDetectionSource {
    Path,
    KnownLocation,
    Explicit,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateAgentSession {
    #[serde(default)]
    pub creation_request_id: Option<String>,
    pub project_id: String,
    pub backend: String,
    #[serde(default)]
    pub executable: String,
    pub title: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub isolated: bool,
}

fn default_mode() -> String {
    "default".into()
}

#[derive(Debug, Deserialize)]
pub struct AgentTurnInput {
    pub session_id: String,
    pub request_id: String,
    pub prompt: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AgentAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAttachment {
    pub name: String,
    pub mime_type: String,
    /// Base64 bytes only. Image data is never written to the conversation transcript.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTool {
    pub id: String,
    pub name: String,
    pub adapter: String,
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment applied to this connection's processes. Two connections for the same product
    /// become separate accounts by pointing at different provider configuration homes. RunHQ never
    /// creates or stores credentials; these only select a home the user authenticated themselves.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub enabled: bool,
}
