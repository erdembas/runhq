export type AgentBackendId = string;
export type AgentAdapter = 'codex' | 'opencode' | 'claude' | 'acp' | 'terminal';
export interface AgentTool {
  id: string;
  name: string;
  adapter: AgentAdapter;
  executable: string;
  args: string[];
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
  title: string;
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
}
