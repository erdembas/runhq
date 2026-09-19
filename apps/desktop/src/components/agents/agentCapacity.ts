import type { AgentSession } from '@runhq/cockpit-types';
import type { QueuedAgentTurn } from './agentTurnQueue';

export interface AgentCapacityPreferences {
  global: number;
  providers: Record<string, number>;
}

const validLimit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8;

export function agentCapacityPreferences(raw: unknown): AgentCapacityPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const providers =
    source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
      ? Object.fromEntries(
          Object.entries(source.providers).filter((entry): entry is [string, number] =>
            validLimit(entry[1]),
          ),
        )
      : {};
  return { global: validLimit(source.global) ? source.global : 8, providers };
}

export const agentOccupiesSlot = (session: AgentSession) =>
  ['starting', 'running', 'waiting_input', 'waiting_permission', 'cancelling'].includes(
    session.status,
  );

export function agentOccupiedSlots(
  sessions: Record<string, AgentSession>,
  queues: Record<string, QueuedAgentTurn[]> = {},
) {
  const occupied = Object.values(sessions).filter(
    (session) =>
      agentOccupiesSlot(session) || queues[session.id]?.some((turn) => turn.state === 'sending'),
  );
  const providers: Record<string, number> = {};
  for (const session of occupied)
    providers[session.backend] = (providers[session.backend] ?? 0) + 1;
  return { total: occupied.length, providers };
}

export function agentCapacityWaitReason(
  backend: string,
  preferences: AgentCapacityPreferences,
  occupied: ReturnType<typeof agentOccupiedSlots>,
): string | null {
  if (occupied.total >= preferences.global) return 'Waiting for a global execution slot';
  if ((occupied.providers[backend] ?? 0) >= (preferences.providers[backend] ?? 8))
    return 'Waiting for a provider execution slot';
  return null;
}

export function agentExecutionState(
  session: AgentSession,
  queue: QueuedAgentTurn[],
  capacityReason: string | null,
) {
  if (session.status === 'cancelling') return 'Stopping';
  if (session.pending.some((request) => request.kind === 'approval'))
    return 'Waiting for permission';
  if (session.pending.length || session.status === 'waiting_input')
    return 'Waiting for your answer';
  if (session.status === 'waiting_permission') return 'Waiting for permission';
  if (session.status === 'starting') return 'Connecting';
  if (session.status === 'running') return 'Working';
  if (session.archived) return queue.length ? 'Archived · queue paused' : 'Archived';
  if (queue[0]?.state === 'failed') return 'Queue paused · review and resume';
  if (queue[0]?.state === 'sending') return 'Sending queued message';
  if (['failed', 'interrupted', 'cancelled'].includes(session.status))
    return queue.length
      ? (capacityReason ?? 'Queue paused after interruption')
      : session.status === 'failed'
        ? 'Failed'
        : 'Stopped';
  if (queue.length) return capacityReason ?? 'Queued · ready to start';
  return session.status === 'completed' ? 'Completed' : 'Ready';
}
