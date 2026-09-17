import { invoke } from '@tauri-apps/api/core';
import type {
  AgentBackend,
  AgentTool,
  AgentCatalog,
  AgentProject,
  AgentSession,
  AgentSnapshot,
  AgentTurnInput,
  CreateAgentSession,
} from '@runhq/cockpit-types';

export const agentIpc = {
  agentSaveTool: (tool: AgentTool) => invoke<void>('agent_save_tool', { tool }),
  agentProjects: () => invoke<AgentProject[]>('agent_projects'),
  agentAddProject: (name: string, path: string) =>
    invoke<AgentProject>('agent_add_project', { name, path }),
  agentSessions: () => invoke<AgentSession[]>('agent_sessions'),
  agentSnapshot: (id: string, before: number | null = null) =>
    invoke<AgentSnapshot>('agent_snapshot', { id, before }),
  agentBackends: () => invoke<AgentBackend[]>('agent_backends'),
  agentCatalog: (
    backend: string,
    executable: string,
    projectId: string,
    sessionId?: string,
    model?: string,
  ) =>
    invoke<AgentCatalog>('agent_catalog', {
      backend,
      executable,
      projectId,
      sessionId: sessionId ?? null,
      model: model ?? null,
    }),
  agentCreate: (input: CreateAgentSession) => invoke<AgentSession>('agent_create', { input }),
  agentStart: (input: AgentTurnInput) => invoke<AgentSession>('agent_start', { input }),
  agentAnswer: (id: string, requestId: string, value: unknown) =>
    invoke<void>('agent_answer', { id, requestId, value }),
  agentInterrupt: (id: string) => invoke<void>('agent_interrupt', { id }),
  agentDelete: (id: string) => invoke<void>('agent_delete', { id }),
  agentSteer: (id: string, text: string) => invoke<void>('agent_steer', { id, text }),
  agentUpdate: (id: string, updates: { title?: string; archived?: boolean; read?: boolean }) =>
    invoke<AgentSession>('agent_update', {
      id,
      title: updates.title ?? null,
      archived: updates.archived ?? null,
      read: updates.read ?? false,
    }),
  agentWorkspaceDiff: (id: string) => invoke<string>('agent_workspace_diff', { id }),
};
