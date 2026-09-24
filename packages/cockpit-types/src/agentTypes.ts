export type AgentBackendId = string;
export type AgentAdapter = 'codex' | 'opencode' | 'claude' | 'acp' | 'terminal';
export interface AgentTool {
  id: string;
  name: string;
  adapter: AgentAdapter;
  executable: string;
  args: string[];
  /** Environment for this connection's processes. Two connections for the same product become
   * separate accounts by pointing at different provider configuration homes. RunHQ never creates or
   * stores credentials; these only select a home the user authenticated themselves. */
  env?: Record<string, string>;
  enabled: boolean;
}
export type AgentStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting_input'
  | 'waiting_permission'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export interface AgentProject {
  id: string;
  name: string;
  path: string;
}
export interface AgentQuestion {
  id: string;
  question: string;
  options: { label: string; description?: string; value?: string }[];
  multiple: boolean;
  secret: boolean;
  allow_custom?: boolean;
}
export interface AgentRequest {
  id: string;
  kind: 'question' | 'approval' | 'form';
  title: string;
  details: string;
  questions: AgentQuestion[] | null;
  choices: { label: string; value: unknown }[] | null;
  /** RunHQ's opt-in workspace grant, advertised only for ordinary tool permissions. */
  workspace_approval?: { decision: string; path: string } | null;
  schema: Record<string, unknown> | null;
  url?: string | null;
}
export interface AgentItem {
  id: string;
  kind: string;
  title: string;
  text: string;
  status: string;
  created_at: number;
}
export interface AgentSession {
  id: string;
  project_id: string;
  project_name: string;
  cwd: string;
  backend: AgentBackendId;
  executable: string;
  adapter?: AgentAdapter;
  backend_name?: string;
  args?: string[];
  /** The connection environment captured when this session was created. */
  env?: Record<string, string>;
  /** The commit this task started from, and the tracked files already modified at that moment, so
   * Changes can separate the agent's edits from what was there before. */
  base_revision?: string | null;
  pre_existing_paths?: string[];
  /** RunHQ's own turn timing in milliseconds; providers report tokens, not duration. */
  turn_started_at?: number | null;
  last_turn_ms?: number | null;
  total_run_ms?: number;
  title: string;
  title_source?: '' | 'auto' | 'generated' | 'manual';
  model: string;
  effort: string;
  mode: 'default' | 'plan';
  agent: string;
  native_id: string | null;
  status: AgentStatus;
  created_at: number;
  updated_at: number;
  revision: number;
  archived: boolean;
  unread: boolean;
  last_error: string | null;
  isolated: boolean;
  branch: string | null;
  usage: unknown;
  runtime_state?: unknown;
  pending: AgentRequest[];
}
export interface AgentSnapshot {
  session: AgentSession;
  items: AgentItem[];
  before: number | null;
}
export interface AgentBackend {
  id: AgentBackendId;
  name: string;
  executable: string | null;
  version: string | null;
  available: boolean;
  error: string | null;
  adapter?: AgentAdapter;
  enabled?: boolean;
  command?: string;
  args?: string[];
  /** The account environment of the underlying connection, so the tools screen can toggle or edit a
   * connection without dropping the account it points at. */
  env?: Record<string, string>;
  detection_status?: 'available' | 'not_found' | 'blocked';
  detection_source?: 'path' | 'known_location' | 'explicit';
}
export interface AgentCatalog {
  models: {
    id: string;
    name: string;
    description?: string;
    resolved_model?: string;
    is_alias?: boolean;
    efforts: string[];
  }[];
  agents: string[];
  commands: string[];
  modes: string[];
  can_steer: boolean;
  can_resume?: boolean;
  connection?: string;
}
export interface CreateAgentSession {
  creation_request_id?: string;
  project_id: string;
  backend: AgentBackendId;
  executable: string;
  title: string;
  model: string;
  effort: string;
  mode: string;
  agent: string;
  isolated: boolean;
}
export interface AgentTurnInput {
  session_id: string;
  request_id: string;
  prompt: string;
  model: string;
  effort: string;
  mode?: 'default' | 'plan';
  agent?: string;
  attachments?: AgentAttachment[];
  /** Explicitly start this turn alongside ordinary tasks in the same checkout. */
  allow_parallel_checkout?: boolean;
}

/** An inline image selected by the user, sent as native provider image content. */
export interface AgentAttachment {
  name: string;
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  /** Base64 bytes only, without a data-URL prefix. */
  data: string;
}
