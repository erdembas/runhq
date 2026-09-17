import type { AgentTurnInput } from '@runhq/cockpit-types';

export interface QueuedAgentTurn extends AgentTurnInput {
  state: 'queued' | 'sending' | 'failed';
  error?: string;
}

/** One dispatcher per app, independent of the currently mounted conversation. */
export function createAgentTurnQueue(deps: {
  canStart: (sessionId: string, manual: boolean) => boolean;
  start: (turn: AgentTurnInput) => Promise<unknown>;
  changed: (queues: Record<string, QueuedAgentTurn[]>) => void;
}) {
  let queues: Record<string, QueuedAgentTurn[]> = {};
  const sending = new Set<string>();
  const update = (id: string, turns: QueuedAgentTurn[]) => {
    queues = { ...queues, [id]: turns };
    deps.changed(queues);
  };
  const pump = async (id: string, manual = false) => {
    const turn = queues[id]?.[0];
    if (
      !turn ||
      sending.has(id) ||
      (!manual && turn.state === 'failed') ||
      !deps.canStart(id, manual)
    )
      return;
    sending.add(id);
    update(
      id,
      (queues[id] ?? []).map((entry) =>
        entry === turn ? { ...entry, state: 'sending', error: undefined } : entry,
      ),
    );
    let accepted = false;
    try {
      const { state: _state, error: _error, ...input } = turn;
      await deps.start(input);
      accepted = true;
      update(
        id,
        (queues[id] ?? []).filter((entry) => entry.request_id !== turn.request_id),
      );
    } catch (error) {
      update(
        id,
        (queues[id] ?? []).map((entry) =>
          entry.request_id === turn.request_id
            ? { ...entry, state: 'failed', error: String(error) }
            : entry,
        ),
      );
    } finally {
      sending.delete(id);
      // A very short turn may have completed before start() returned.
      if (accepted) void pump(id);
    }
  };
  return {
    notify: (id: string) => {
      void pump(id);
    },
    resume: (id: string) => {
      void pump(id, true);
    },
    enqueue: (input: AgentTurnInput) => {
      if (!input.prompt.trim()) return;
      if ((queues[input.session_id] ?? []).some((entry) => entry.request_id === input.request_id))
        return;
      update(input.session_id, [
        ...(queues[input.session_id] ?? []),
        { ...input, state: 'queued' },
      ]);
      void pump(input.session_id);
    },
    remove: (id: string, requestId: string) => {
      update(
        id,
        (queues[id] ?? []).filter(
          (entry) => entry.request_id !== requestId || entry.state === 'sending',
        ),
      );
      void pump(id);
    },
    move: (id: string, requestId: string, direction: -1 | 1) => {
      const entries = [...(queues[id] ?? [])];
      const index = entries.findIndex((entry) => entry.request_id === requestId);
      const target = index + direction;
      const current = entries[index];
      const neighbor = entries[target];
      if (!current || !neighbor || current.state !== 'queued' || neighbor.state !== 'queued')
        return;
      [entries[index], entries[target]] = [neighbor, current];
      update(id, entries);
    },
    clear: (id: string) => {
      update(id, []);
    },
  };
}
