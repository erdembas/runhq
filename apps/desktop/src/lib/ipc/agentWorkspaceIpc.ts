import { invoke } from '@tauri-apps/api/core';
import type { AgentSession, CreateAgentSession } from '@runhq/cockpit-types';
import type { AgentHistoryHit } from '@/components/agents/agentLibraryModel';

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
  search: (query: {
    query: string;
    project_id?: string;
    backend?: string;
    status?: string;
    before?: number;
    from_date?: number;
    to_date?: number;
  }) => invoke<AgentHistoryHit[]>('agent_history_search', { query }),
  exportHistory: (projectId?: string) =>
    invoke<unknown>('agent_history_export', { projectId: projectId || null }),
  importHistory: (projectId: string, archive: unknown) =>
    invoke<number>('agent_history_import', { projectId, archive }),
  retentionPreview: (projectId: string, before: number) =>
    invoke<AgentSession[]>('agent_history_retention_preview', {
      projectId: projectId || null,
      before,
    }),
  retentionRemove: (id: string, revision: number) =>
    invoke<void>('agent_history_retention_remove', { id, revision }),
  contextFile: (projectId: string, sessionId: string | undefined, relativePath: string) =>
    invoke<{
      name: string;
      project_id: string;
      path: string;
      captured_at: number;
      content: string;
    }>('agent_context_file', { projectId, sessionId: sessionId || null, relativePath }),
};
