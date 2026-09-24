import type { AgentItem } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import { useAgentStore } from '@/store/useAgentStore';
import {
  useWorkbenchStore,
  type AgentWorkspaceView,
  type ProjectSection,
} from '@/store/useWorkbenchStore';

let navigationRequest = 0;
const comparablePath = (path: string) => path.replace(/[\\/]+$/, '');

export function openAgentView(view: AgentWorkspaceView, projectId?: string) {
  navigationRequest += 1;
  useAgentStore.getState().open(projectId);
  useWorkbenchStore.getState().requestAgentView(view);
  useWorkbenchStore.getState().setFocusMode(false);
}

export function openProjectSection(serviceId: string, section: ProjectSection = 'overview') {
  navigationRequest += 1;
  useWorkbenchStore.getState().setProjectSection(serviceId, section);
  useAppStore.getState().setSelected(serviceId);
  useWorkbenchStore.getState().setFocusMode(false);
}

export function openProjectDoc(serviceId: string, relativePath: string) {
  const service = useAppStore.getState().services.find((entry) => entry.id === serviceId);
  if (!service) return;
  useWorkbenchStore.setState((state) => ({
    projectDocRequests: {
      ...state.projectDocRequests,
      [serviceId]: {
        cwd: service.cwd,
        relativePath,
        revision: (state.projectDocRequests[serviceId]?.revision ?? 0) + 1,
      },
    },
  }));
  openProjectSection(serviceId, 'docs');
}

export async function openProjectAgentView(serviceId: string, view: AgentWorkspaceView) {
  const request = ++navigationRequest;
  const sourceTab = useAppStore.getState().activeMainTabKey;
  const service = useAppStore.getState().services.find((entry) => entry.id === serviceId);
  if (!service) return;
  if (view === 'overview' || view === 'conversations') {
    openProjectSection(serviceId, 'agents');
    return;
  }
  // The backend resolves symlinks and shared service directories to one project identity.
  const project = await ipc.agentAddProject(service.name, service.cwd);
  if (useAppStore.getState().services.find((entry) => entry.id === serviceId)?.cwd !== service.cwd)
    return;
  useWorkbenchStore.getState().registerServiceAgentProject(serviceId, service.cwd, project);
  useAgentStore.setState((state) => ({
    projects: [...state.projects.filter((entry) => entry.id !== project.id), project],
  }));
  if (request === navigationRequest && useAppStore.getState().activeMainTabKey === sourceTab)
    openAgentView(view, project.id);
}

export function openAgentTask(
  sessionId: string,
  options: { focusItemId?: string; workflowId?: string; projectId?: string } = {},
) {
  navigationRequest += 1;
  const session = useAgentStore.getState().sessions[sessionId];
  const projectId = session?.project_id ?? options.projectId;
  const app = useAppStore.getState();
  const workbench = useWorkbenchStore.getState();
  const project = useAgentStore.getState().projects.find((entry) => entry.id === projectId);
  const registeredPaths = new Set(
    app.services.flatMap((service) => {
      const cached = workbench.serviceAgentProjects[service.id];
      return projectId && cached?.cwd === service.cwd && cached.project.id === projectId
        ? [comparablePath(service.cwd)]
        : [];
    }),
  );
  const matches = app.services.filter((service) => {
    if (project?.workspace || session?.workspace) return false;
    if (registeredPaths.has(comparablePath(service.cwd))) return true;
    if (project && comparablePath(project.path) === comparablePath(service.cwd)) return true;
    // A task's isolated checkout is not its source project. Only a local session can supply
    // the fallback path while the project catalog is still loading.
    return (
      !!session && !session.isolated && comparablePath(session.cwd) === comparablePath(service.cwd)
    );
  });
  const owner = matches.find((service) => service.id === app.selectedServiceId) ?? matches[0];
  useWorkbenchStore.setState((state) => {
    const taskFocusItems = { ...state.taskFocusItems };
    const taskFocusRevision = state.taskFocusRevision + 1;
    if (options.focusItemId) {
      taskFocusItems[sessionId] = { itemId: options.focusItemId, revision: taskFocusRevision };
    } else {
      // Ordinary navigation must not replay a previously requested decision/history jump.
      delete taskFocusItems[sessionId];
    }
    return {
      taskOrigins: options.workflowId
        ? {
            ...state.taskOrigins,
            [sessionId]: {
              workflowId: options.workflowId,
              projectId: options.projectId ?? session?.project_id,
            },
          }
        : state.taskOrigins,
      taskFocusItems,
      taskFocusRevision,
    };
  });
  if (owner && projectId) {
    useWorkbenchStore.getState().setProjectSelectedSession(projectId, sessionId);
    openProjectSection(owner.id, 'agents');
  } else {
    // Agent-only projects have no runtime service tab; their conversations stay in Tasks.
    openAgentView('conversations', projectId ?? '');
    useAgentStore.getState().select(sessionId);
  }
}

export function openWorkflow(workflowId: string, projectId?: string) {
  useWorkbenchStore.setState({ requestedWorkflowId: workflowId });
  openAgentView('workflows', projectId);
}

export function requestTaskHandoff(sessionId: string, items: AgentItem[]) {
  const session = useAgentStore.getState().sessions[sessionId];
  useWorkbenchStore.setState((state) => ({
    agentHandoff: { sessionId, items, revision: (state.agentHandoff?.revision ?? 0) + 1 },
  }));
  openAgentView('conversations', session?.project_id);
}
