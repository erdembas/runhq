import { create } from 'zustand';
import { agentWorkspaceIpc, type AgentWorkspaceRecord } from '@/lib/ipc/agentWorkspaceIpc';

interface AgentLibraryState {
  records: Record<string, AgentWorkspaceRecord>;
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (key: string, value: unknown | null) => Promise<void>;
}
let pending: Promise<void> | null = null;
export const useAgentLibraryStore = create<AgentLibraryState>((set) => ({
  records: {},
  ready: false,
  error: null,
  refresh: () => {
    if (!pending)
      pending = agentWorkspaceIpc
        .records()
        .then((records) => {
          set({
            records: Object.fromEntries(records.map((r) => [r.key, r])),
            ready: true,
            error: null,
          });
        })
        .catch((error) => {
          set({ error: String(error) });
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  },
  save: async (key, value) => {
    // Serialize against initial hydration so old data cannot overwrite a successful save.
    if (pending) await pending;
    try {
      await agentWorkspaceIpc.save(key, value);
      set((state) => {
        const records = { ...state.records };
        if (value === null) delete records[key];
        else records[key] = { key, value, updated_at: Date.now() };
        return { records, error: null };
      });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
