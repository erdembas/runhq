import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { AgentBackend, AgentProject, AgentSession } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { clearAgentLocalArtifacts } from '@/lib/agentLocalArtifacts';
import { useAppStore } from './useAppStore';

export interface AgentStore {
  tools: AgentBackend[];
  toolsLoading: boolean;
  toolsReady: boolean;
  toolsError: string | null;
  toolsCheckedAt: number;
  toolsOpen: boolean;
  refreshTools: (afterMutation?: boolean) => Promise<void>;
  sessions: Record<string, AgentSession>;
  projects: AgentProject[];
  selectedId: string | null;
  projectFilter: string;
  error: string | null;
  ready: boolean;
  drafts: Record<string, string>;
  deletedIds: Record<string, true>;
  remove: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  setDraft: (id: string, text: string) => void;
  merge: (session: AgentSession) => void;
  refresh: (afterMutation?: boolean) => Promise<void>;
  select: (id: string | null) => void;
  open: (projectId?: string) => void;
}
let toolsRefresh: Promise<void> | null = null;
let workspaceRefresh: Promise<void> | null = null;

export const useAgentStore = create<AgentStore>((set, get) => ({
  tools: [],
  toolsLoading: false,
  toolsReady: false,
  toolsError: null,
  toolsCheckedAt: 0,
  toolsOpen: false,
  refreshTools: (afterMutation = false) => {
    if (afterMutation && toolsRefresh)
      return toolsRefresh.catch(() => undefined).then(() => get().refreshTools());
    if (!toolsRefresh) {
      set({ toolsLoading: true, toolsError: null });
      toolsRefresh = ipc
        .agentBackends()
        .then((tools) =>
          set((state) => ({
            tools: JSON.stringify(tools) === JSON.stringify(state.tools) ? state.tools : tools,
            toolsReady: true,
            toolsCheckedAt: Date.now(),
          })),
        )
        .catch((error) => {
          // Keep the last known tools and keep discovery failures separate from project data.
          set({ toolsError: String(error), toolsReady: true, toolsCheckedAt: Date.now() });
          throw error;
        })
        .finally(() => {
          toolsRefresh = null;
          set({ toolsLoading: false });
        });
    }
    return toolsRefresh;
  },
  sessions: {},
  projects: [],
  selectedId: null,
  projectFilter: '',
  error: null,
  ready: false,
  drafts: {},
  deletedIds: {},
  remove: (id) =>
    set((state) => {
      try {
        clearAgentLocalArtifacts(id, localStorage);
      } catch {
        /* Storage may be unavailable in this webview. */
      }
      const sessions = { ...state.sessions };
      const drafts = { ...state.drafts };
      delete sessions[id];
      delete drafts[id];
      return {
        sessions,
        drafts,
        selectedId: state.selectedId === id ? null : state.selectedId,
        deletedIds: { ...state.deletedIds, [id]: true },
      };
    }),
  deleteSession: async (id) => {
    await ipc.agentDelete(id);
    get().remove(id);
  },
  setDraft: (id, text) =>
    set((s) => ((s.drafts[id] ?? '') === text ? s : { drafts: { ...s.drafts, [id]: text } })),
  merge: (session) =>
    set((state) => {
      // A late snapshot or change event must not resurrect a deleted conversation.
      if (state.deletedIds[session.id]) return state;
      if ((state.sessions[session.id]?.revision ?? -1) >= session.revision) return state;
      return { sessions: { ...state.sessions, [session.id]: session } };
    }),
  refresh: (afterMutation = false) => {
    // A mutation must read again after any older request; ordinary callers can share it.
    if (afterMutation && workspaceRefresh) return workspaceRefresh.then(() => get().refresh());
    if (!workspaceRefresh)
      workspaceRefresh = Promise.all([ipc.agentProjects(), ipc.agentSessions()])
        .then(([projects, incoming]) => {
          // Publish one revision-checked snapshot. Copying the complete session record for
          // every row turns startup/refresh into quadratic work and wakes every subscriber.
          set((state) => {
            let sessions = state.sessions;
            for (const session of incoming) {
              if (
                state.deletedIds[session.id] ||
                (sessions[session.id]?.revision ?? -1) >= session.revision
              )
                continue;
              if (sessions === state.sessions) sessions = { ...sessions };
              sessions[session.id] = session;
            }
            const sameProjects =
              projects.length === state.projects.length &&
              projects.every((project, i) => {
                const previous = state.projects[i];
                return (
                  project.id === previous?.id &&
                  project.name === previous.name &&
                  project.path === previous.path
                );
              });
            if (sessions === state.sessions && sameProjects && state.ready && !state.error)
              return state;
            return {
              sessions,
              projects: sameProjects ? state.projects : projects,
              ready: true,
              error: null,
            };
          });
        })
        .catch((e) => set({ error: String(e), ready: true }))
        .finally(() => {
          workspaceRefresh = null;
        });
    return workspaceRefresh;
  },
  select: (id) => {
    set({ selectedId: id });
    if (id && get().sessions[id]?.unread)
      void ipc
        .agentUpdate(id, { read: true })
        .then(get().merge)
        .catch((e) => {
          if (!get().deletedIds[id]) set({ error: String(e) });
        });
  },
  open: (projectId) => {
    if (projectId !== undefined) set({ projectFilter: projectId, selectedId: null });
    useAppStore.getState().openMainTab({ kind: 'agents', refId: 'agents' });
  },
}));

let connection: Promise<void> | null = null;
export function connectAgents() {
  if (!connection)
    connection = (async () => {
      // Subscribe first. Revision comparison keeps a late snapshot from overwriting live state.
      await listen<AgentSession>('agent://changed', (event) =>
        useAgentStore.getState().merge(event.payload),
      );
      await listen<string>('agent://deleted', (event) =>
        useAgentStore.getState().remove(event.payload),
      );
      await Promise.all([
        useAgentStore.getState().refresh(),
        useAgentStore
          .getState()
          .refreshTools()
          .catch(() => undefined),
      ]);
      window.setInterval(() => {
        void useAgentStore.getState().refresh();
      }, 15000);
    })().catch((error) => {
      connection = null;
      useAgentStore.setState({ error: String(error), ready: true });
    });
  return connection;
}
