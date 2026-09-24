import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentTurnInput } from '@runhq/cockpit-types';
import { validateAgentAttachments } from '@runhq/cockpit-ui';
import { isAgentTaskStartDependency, type AgentTaskStartDependency } from './agentTaskStart';

export interface QueuedAgentTurn extends AgentTurnInput {
  startAfter?: AgentTaskStartDependency;
  state: 'queued' | 'interrupting' | 'sending' | 'failed';
  error?: string;
}

export function isAgentQueueRecord(value: unknown): value is Record<string, QueuedAgentTurn[]> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, entries]) =>
        Array.isArray(entries) &&
        entries.every((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false;
          const turn = entry as Partial<QueuedAgentTurn>;
          return (
            turn.session_id === id &&
            typeof turn.request_id === 'string' &&
            !!turn.request_id &&
            typeof turn.prompt === 'string' &&
            typeof turn.model === 'string' &&
            typeof turn.effort === 'string' &&
            (turn.allow_parallel_checkout === undefined ||
              typeof turn.allow_parallel_checkout === 'boolean') &&
            (turn.startAfter === undefined ||
              (isAgentTaskStartDependency(turn.startAfter) && turn.startAfter.sessionId !== id)) &&
            ['queued', 'interrupting', 'sending', 'failed'].includes(turn.state ?? '') &&
            (turn.mode === undefined || turn.mode === 'default' || turn.mode === 'plan') &&
            (turn.agent === undefined || typeof turn.agent === 'string') &&
            (turn.attachments === undefined ||
              (Array.isArray(turn.attachments) &&
                turn.attachments.every(
                  (attachment) =>
                    !!attachment &&
                    typeof attachment === 'object' &&
                    typeof attachment.name === 'string' &&
                    typeof attachment.mime_type === 'string' &&
                    typeof attachment.data === 'string',
                ) &&
                !validateAgentAttachments(turn.attachments)))
          );
        }) &&
        new Set(entries.map((entry) => entry.request_id)).size === entries.length,
    )
  );
}

/** Every restored queue is paused. A lost dispatch acknowledgement is never replayed. */
export function recoverAgentQueues(queues: Record<string, QueuedAgentTurn[]>) {
  return Object.fromEntries(
    Object.entries(queues).map(([id, entries]) => [
      id,
      entries.map((turn, index): QueuedAgentTurn =>
        index === 0 || turn.state === 'sending' || turn.state === 'interrupting'
          ? {
              ...turn,
              state: 'failed',
              error:
                turn.state === 'sending'
                  ? i18n.t(
                      'RunHQ closed while this message was being sent. Check the conversation before resuming; it may already have been accepted.',
                    )
                  : (turn.error ??
                    'Recovered after restart. Review this queue, then resume when ready.'),
            }
          : { ...turn },
      ),
    ]),
  );
}

/** One dispatcher per app, independent of the currently mounted conversation. */
export function createAgentTurnQueue(deps: {
  canStart: (sessionId: string, manual: boolean) => boolean;
  isActive?: (sessionId: string) => boolean;
  interrupt?: (sessionId: string) => Promise<void>;
  dependencyState?: (turn: QueuedAgentTurn) => 'ready' | 'waiting' | 'blocked';
  start: (turn: AgentTurnInput) => Promise<unknown>;
  changed: (queues: Record<string, QueuedAgentTurn[]>) => boolean | void;
  initial?: Record<string, QueuedAgentTurn[]>;
}) {
  let queues: Record<string, QueuedAgentTurn[]> = deps.initial ?? {};
  const sending = new Set<string>();
  const interrupting = new Set<string>();
  const resumed = new Map<string, string>();
  const update = (id: string, turns: QueuedAgentTurn[]) => {
    queues = { ...queues, [id]: turns };
    return deps.changed(queues) !== false;
  };
  const pump = async (id: string, manual = false) => {
    let turn = queues[id]?.[0];
    if (interrupting.has(id)) return;
    if (turn?.state === 'interrupting' && deps.isActive?.(id) === false) {
      turn = { ...turn, state: 'queued' };
      if (!update(id, [turn, ...(queues[id] ?? []).slice(1)])) {
        resumed.delete(id);
        update(id, [
          {
            ...turn,
            state: 'failed',
            error: i18n.t('Could not save the queued task. Retry saving before continuing.'),
          },
          ...(queues[id] ?? []).slice(1),
        ]);
        return;
      }
    }
    manual = manual || (!!turn && resumed.get(id) === turn.request_id);
    if (
      !turn ||
      sending.has(id) ||
      (!manual && turn.state === 'failed') ||
      !deps.canStart(id, manual)
    )
      return;
    if (turn.startAfter) {
      const state = deps.dependencyState?.(turn) ?? 'waiting';
      if (state === 'waiting') return;
      if (state === 'blocked') {
        resumed.delete(id);
        update(
          id,
          (queues[id] ?? []).map((entry) =>
            entry === turn
              ? {
                  ...entry,
                  state: 'failed',
                  error: i18n.t(
                    'The preceding task did not complete successfully or is no longer available. Review it, then start now or remove this queued message.',
                  ),
                }
              : entry,
          ),
        );
        return;
      }
    }
    resumed.delete(id);
    sending.add(id);
    const saved = update(
      id,
      (queues[id] ?? []).map((entry) =>
        entry === turn ? { ...entry, state: 'sending', error: undefined } : entry,
      ),
    );
    if (!saved) {
      update(
        id,
        (queues[id] ?? []).map((entry) =>
          entry.request_id === turn.request_id
            ? {
                ...entry,
                state: 'failed',
                error: i18n.t(
                  'Message was not sent because local recovery could not be saved. Retry saving before resuming.',
                ),
              }
            : entry,
        ),
      );
      sending.delete(id);
      return;
    }
    let accepted = false;
    try {
      const { state: _state, error: _error, startAfter: _startAfter, ...input } = turn;
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
    /** Interrupt the current turn, then dispatch the chosen message in this same session. */
    sendNow: async (id: string, requestId: string) => {
      const entries = queues[id] ?? [];
      const turn = entries.find((entry) => entry.request_id === requestId);
      if (
        !turn ||
        !deps.interrupt ||
        entries[0]?.startAfter ||
        sending.has(id) ||
        interrupting.has(id) ||
        entries.some((entry) => entry.state === 'sending' || entry.state === 'interrupting')
      )
        return;
      // Persist the chosen message before stopping work. Keep the request ID, attachments,
      // model and session, and preserve the relative order of every other queued message.
      interrupting.add(id);
      const saved = update(id, [
        { ...turn, allow_parallel_checkout: true, state: 'interrupting', error: undefined },
        ...entries.filter((entry) => entry !== turn),
      ]);
      if (!saved) {
        interrupting.delete(id);
        resumed.delete(id);
        update(
          id,
          (queues[id] ?? []).map((entry) =>
            entry.request_id === requestId
              ? {
                  ...entry,
                  state: 'failed',
                  error: i18n.t('Could not save the queued task. Retry saving before continuing.'),
                }
              : entry,
          ),
        );
        return;
      }
      resumed.set(id, requestId);
      let stopped = false;
      try {
        await deps.interrupt(id);
        stopped = true;
      } catch (error) {
        resumed.delete(id);
        if (queues[id]?.some((entry) => entry.request_id === requestId))
          update(
            id,
            queues[id].map((entry) =>
              entry.request_id === requestId
                ? { ...entry, state: 'failed', error: String(error) }
                : entry,
            ),
          );
      } finally {
        interrupting.delete(id);
      }
      // An interrupt acknowledgement may precede shutdown. canStart still waits for
      // the inactive session snapshot and capacity before admitting the next turn.
      if (stopped && queues[id]?.[0]?.request_id === requestId) await pump(id, true);
    },
    startNow: (id: string) => {
      const turn = queues[id]?.[0];
      if (!turn?.startAfter || sending.has(id) || interrupting.has(id)) return;
      resumed.set(id, turn.request_id);
      const saved = update(
        id,
        (queues[id] ?? []).map((entry) =>
          entry === turn
            ? {
                ...entry,
                startAfter: undefined,
                allow_parallel_checkout: true,
                state: 'queued',
                error: undefined,
              }
            : entry,
        ),
      );
      if (saved) void pump(id, true);
    },
    notify: (id: string) => {
      void pump(id);
    },
    resume: (id: string) => {
      const turn = queues[id]?.[0];
      if (!turn || turn.state === 'sending' || turn.state === 'interrupting') return;
      resumed.set(id, turn.request_id);
      update(
        id,
        (queues[id] ?? []).map((entry) =>
          entry === turn ? { ...entry, state: 'queued', error: undefined } : entry,
        ),
      );
      void pump(id, true);
    },
    enqueue: (input: AgentTurnInput & { startAfter?: AgentTaskStartDependency }) => {
      if (!input.prompt.trim()) return false;
      if ((queues[input.session_id] ?? []).some((entry) => entry.request_id === input.request_id))
        return false;
      const saved = update(input.session_id, [
        ...(queues[input.session_id] ?? []),
        { ...input, state: 'queued' },
      ]);
      if (saved) void pump(input.session_id);
      return saved;
    },
    remove: (id: string, requestId: string) => {
      update(
        id,
        (queues[id] ?? []).filter(
          (entry) =>
            entry.request_id !== requestId ||
            entry.state === 'sending' ||
            entry.state === 'interrupting',
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
      if (
        !current ||
        !neighbor ||
        current.state !== 'queued' ||
        neighbor.state !== 'queued' ||
        current.startAfter ||
        neighbor.startAfter
      )
        return;
      [entries[index], entries[target]] = [neighbor, current];
      update(id, entries);
    },
    clear: (id: string) => {
      resumed.delete(id);
      update(id, []);
    },
  };
}
