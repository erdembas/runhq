import { create } from 'zustand';
import type { AgentItem, AgentProject } from '@runhq/cockpit-types';

export type AgentWorkspaceView =
  'overview' | 'conversations' | 'inbox' | 'workflows' | 'library' | 'usage';
export type ProjectSection = 'overview' | 'agents' | 'run' | 'git' | 'docs' | 'notes' | 'health';
export type ProjectGitView = 'commit' | 'branches' | 'history' | 'graph';

interface WorkbenchState {
  agentView: AgentWorkspaceView;
  agentViewRevision: number;
  requestedWorkflowId: string | null;
  agentHandoff: { sessionId: string; items: AgentItem[]; revision: number } | null;
  projectSections: Record<string, ProjectSection>;
  projectGitRequests: Record<string, { tab: ProjectGitView; revision: number }>;
  projectDocRequests: Record<string, { cwd: string; relativePath: string; revision: number }>;
  projectSelectedSessions: Record<string, string | null>;
  projectSelectionRevisions: Record<string, number>;
  serviceAgentProjects: Record<string, { cwd: string; project: AgentProject }>;
  focusMode: boolean;
  taskOrigins: Record<string, { workflowId?: string; projectId?: string }>;
  taskFocusItems: Record<string, { itemId: string; revision: number }>;
  taskFocusRevision: number;
  requestAgentView: (view: AgentWorkspaceView) => void;
  setProjectSection: (serviceId: string, section: ProjectSection) => void;
  setProjectSelectedSession: (projectId: string, sessionId: string | null) => void;
  registerServiceAgentProject: (serviceId: string, cwd: string, project: AgentProject) => void;
  requestProjectGitView: (serviceId: string, tab?: ProjectGitView) => void;
  setFocusMode: (focused: boolean) => void;
}

/** Presentation state only. Changing the workbench never starts or stops work. */
export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  agentView: 'overview',
  agentViewRevision: 0,
  requestedWorkflowId: null,
  agentHandoff: null,
  projectSections: {},
  projectGitRequests: {},
  projectDocRequests: {},
  projectSelectedSessions: {},
  projectSelectionRevisions: {},
  serviceAgentProjects: {},
  focusMode: false,
  taskOrigins: {},
  taskFocusItems: {},
  taskFocusRevision: 0,
  requestAgentView: (agentView) =>
    set((state) => ({
      agentView,
      agentViewRevision: state.agentViewRevision + 1,
    })),
  setProjectSection: (serviceId, section) =>
    set((state) => ({
      projectSections: { ...state.projectSections, [serviceId]: section },
    })),
  setProjectSelectedSession: (projectId, sessionId) =>
    set((state) => ({
      projectSelectedSessions: { ...state.projectSelectedSessions, [projectId]: sessionId },
      projectSelectionRevisions: {
        ...state.projectSelectionRevisions,
        [projectId]: (state.projectSelectionRevisions[projectId] ?? 0) + 1,
      },
    })),
  registerServiceAgentProject: (serviceId, cwd, project) =>
    set((state) => ({
      serviceAgentProjects: { ...state.serviceAgentProjects, [serviceId]: { cwd, project } },
    })),
  requestProjectGitView: (serviceId, tab = 'commit') =>
    set((state) => ({
      projectSections: { ...state.projectSections, [serviceId]: 'git' },
      projectGitRequests: {
        ...state.projectGitRequests,
        [serviceId]: {
          tab,
          revision: (state.projectGitRequests[serviceId]?.revision ?? 0) + 1,
        },
      },
      focusMode: false,
    })),
  setFocusMode: (focusMode) => set({ focusMode }),
}));
