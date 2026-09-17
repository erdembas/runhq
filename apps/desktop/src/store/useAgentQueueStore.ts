import { create } from 'zustand';
import { agentIsActive } from '@runhq/cockpit-ui';
import { ipc } from '@/lib/ipc';
import { createAgentTurnQueue, type QueuedAgentTurn } from '@/components/agents/agentTurnQueue';
import { useAgentStore } from './useAgentStore';

export const useAgentQueueStore = create<{ queues: Record<string, QueuedAgentTurn[]> }>(() => ({
  queues: {},
}));

export const agentTurnQueue = createAgentTurnQueue({
  canStart: (id, manual) => {
    const store = useAgentStore.getState();
    const session = store.sessions[id];
    return (
      !!session &&
      !session.archived &&
      !agentIsActive(session.status) &&
      !session.pending.length &&
      store.tools.some((tool) => tool.id === session.backend && tool.enabled !== false) &&
      (manual || session.status === 'completed' || session.status === 'idle')
    );
  },
  start: async (turn) => useAgentStore.getState().merge(await ipc.agentStart(turn)),
  changed: (queues) => useAgentQueueStore.setState({ queues }),
});

useAgentStore.subscribe((state, previous) => {
  for (const id of Object.keys(useAgentQueueStore.getState().queues)) {
    if (state.deletedIds[id]) agentTurnQueue.clear(id);
    else if (state.sessions[id] !== previous.sessions[id] || state.tools !== previous.tools)
      agentTurnQueue.notify(id);
  }
});
