import { useEffect } from 'react';
import { create } from 'zustand';
import { agentWorkflowIpc } from '@/lib/ipc/agentWorkflowIpc';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { collectWorkflowAttention, type WorkflowAttentionEntry } from './agentWorkflowAttention';
import { workflowPollInterval } from './agentWorkflowGraph';

interface WorkflowAttentionState {
  entries: WorkflowAttentionEntry[];
  loaded: boolean;
  error: string | null;
}

const useWorkflowAttentionStore = create<WorkflowAttentionState>(() => ({
  entries: [],
  loaded: false,
  error: null,
}));

let observers = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let interval = 5000;
let pending: Promise<void> | null = null;

/** The navigation badge and Inbox share one read-only workflow snapshot and one polling loop. */
export function refreshWorkflowAttention(): Promise<void> {
  if (pending) return pending;
  pending = agentWorkflowIpc
    .list()
    .then(
      (workflows) => {
        interval = workflowPollInterval(workflows);
        useWorkflowAttentionStore.setState({
          entries: collectWorkflowAttention(workflows),
          loaded: true,
          error: null,
        });
      },
      (failure) => {
        useWorkflowAttentionStore.setState({ loaded: true, error: String(failure) });
      },
    )
    .finally(() => {
      pending = null;
    });
  return pending;
}

function observeWorkflowAttention() {
  observers += 1;
  if (observers === 1) {
    const currentGeneration = ++generation;
    const poll = async () => {
      await refreshWorkflowAttention();
      if (observers && currentGeneration === generation)
        timer = setTimeout(() => void poll(), interval);
    };
    void poll();
  }
  return () => {
    observers -= 1;
    if (!observers) {
      generation += 1;
      clearTimeout(timer);
    }
  };
}

export function useAgentWorkflowAttention(visible = true) {
  useEffect(() => {
    if (visible) return observeWorkflowAttention();
  }, [visible]);
  const entries = useVisibleStore(useWorkflowAttentionStore, (state) => state.entries, visible);
  const loaded = useVisibleStore(useWorkflowAttentionStore, (state) => state.loaded, visible);
  const error = useVisibleStore(useWorkflowAttentionStore, (state) => state.error, visible);
  return { entries, loading: !loaded, error, refresh: refreshWorkflowAttention };
}
