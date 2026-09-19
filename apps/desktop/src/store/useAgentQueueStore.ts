import { create } from 'zustand';
import { agentIsActive } from '@runhq/cockpit-ui';
import { ipc } from '@/lib/ipc';
import {
  createAgentTurnQueue,
  isAgentQueueRecord,
  recoverAgentQueues,
  type QueuedAgentTurn,
} from '@/components/agents/agentTurnQueue';
import { createAgentRecoveryPersistence } from '@/lib/agentRecoveryPersistence';
import { useAgentStore } from './useAgentStore';
import { useAgentLibraryStore } from './useAgentLibraryStore';
import { agentSessionIsHistoryOnly } from '@/components/agents/agentComposerPolicy';
import { agentUsagePreferences, evaluateAgentUsage } from '@/components/agents/agentUsagePolicy';
import {
  agentCapacityPreferences,
  agentCapacityWaitReason,
  agentOccupiedSlots,
} from '@/components/agents/agentCapacity';

const persistence = createAgentRecoveryPersistence('runhq.agent-queues.v1', isAgentQueueRecord);
const restored = persistence.load({});
const initial = recoverAgentQueues(restored.data);

export const useAgentQueueStore = create<{
  queues: Record<string, QueuedAgentTurn[]>;
  persistenceError: string | null;
  recoveredSessionIds: string[];
  retryPersistence: () => void;
}>((set, get) => ({
  queues: initial,
  persistenceError: restored.error,
  recoveredSessionIds: Object.keys(initial).filter((id) => initial[id]?.length),
  retryPersistence: () => set({ persistenceError: persistence.save(get().queues) }),
}));

export const agentTurnQueue = createAgentTurnQueue({
  initial,
  canStart: (id, manual) => {
    const store = useAgentStore.getState();
    const session = store.sessions[id];
    const library = useAgentLibraryStore.getState();
    const capacity = agentCapacityPreferences(library.records['preferences:capacity']?.value);
    const usage = agentUsagePreferences(library.records['preferences:usage']?.value);
    return (
      !!session &&
      !agentSessionIsHistoryOnly(session) &&
      !evaluateAgentUsage(session.usage, usage.providers[session.backend]).pauseReason &&
      library.ready &&
      !agentCapacityWaitReason(
        session.backend,
        capacity,
        agentOccupiedSlots(store.sessions, useAgentQueueStore.getState().queues),
      ) &&
      !session.archived &&
      !agentIsActive(session.status) &&
      !session.pending.length &&
      store.tools.some((tool) => tool.id === session.backend && tool.enabled !== false) &&
      (manual || session.status === 'completed' || session.status === 'idle')
    );
  },
  start: async (turn) => useAgentStore.getState().merge(await ipc.agentStart(turn)),
  changed: (queues) => {
    const persistenceError = persistence.save(queues);
    useAgentQueueStore.setState((state) => ({
      queues,
      persistenceError,
      recoveredSessionIds: state.recoveredSessionIds.filter(
        (id) => queues[id]?.[0]?.state === 'failed',
      ),
    }));
    return !persistenceError;
  },
});

useAgentStore.subscribe((state, previous) => {
  for (const id of Object.keys(useAgentQueueStore.getState().queues)) {
    if (state.deletedIds[id]) agentTurnQueue.clear(id);
    else if (state.sessions !== previous.sessions || state.tools !== previous.tools)
      agentTurnQueue.notify(id);
  }
});

useAgentLibraryStore.subscribe((state, previous) => {
  if (
    state.ready !== previous.ready ||
    state.records['preferences:capacity'] !== previous.records['preferences:capacity'] ||
    state.records['preferences:usage'] !== previous.records['preferences:usage']
  )
    for (const id of Object.keys(useAgentQueueStore.getState().queues)) agentTurnQueue.notify(id);
});

// Capacity must hydrate even when a queue is used from a project conversation rather than Usage.
void useAgentLibraryStore.getState().refresh();
