import { invoke } from '@tauri-apps/api/core';
import type { AgentSession, CreateAgentSession } from '@runhq/cockpit-types';

export interface AgentWorkspaceRecord {
  key: string;
  value: unknown;
  updated_at: number;
}
export const agentWorkspaceIpc = {
  handoffCreate: (sourceId: string, input: CreateAgentSession) =>
    invoke<AgentSession>('agent_handoff_create', { sourceId, input }),
  records: () => invoke<AgentWorkspaceRecord[]>('agent_workspace_data'),
  save: (key: string, value: unknown | null) =>
    invoke<void>('agent_workspace_save', { key, value }),
  contextFile: (projectId: string, sessionId: string | undefined, relativePath: string) =>
    invoke<{
      name: string;
      project_id: string;
      path: string;
      captured_at: number;
      content: string;
    }>('agent_context_file', { projectId, sessionId: sessionId || null, relativePath }),
};
