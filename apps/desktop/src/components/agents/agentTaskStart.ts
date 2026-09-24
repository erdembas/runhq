import type { AgentSession } from '@runhq/cockpit-types';

export interface AgentTaskStartDependency {
  sessionId: string;
  title: string;
}

export function isAgentTaskStartDependency(value: unknown): value is AgentTaskStartDependency {
  if (!value || typeof value !== 'object') return false;
  const dependency = value as Partial<AgentTaskStartDependency>;
  return (
    typeof dependency.sessionId === 'string' &&
    !!dependency.sessionId &&
    typeof dependency.title === 'string'
  );
}

/** Missing snapshots may still be loading; only a confirmed deletion releases that ambiguity. */
export function agentTaskDependencyState(
  target: AgentSession | undefined,
  preceding: AgentSession | undefined,
  deleted: boolean,
): 'ready' | 'waiting' | 'blocked' {
  if (deleted) return 'blocked';
  if (!target || !preceding) return 'waiting';
  if (
    target.id === preceding.id ||
    target.project_id !== preceding.project_id ||
    preceding.archived
  )
    return 'blocked';
  if (['failed', 'interrupted', 'cancelled'].includes(preceding.status)) return 'blocked';
  return preceding.status === 'completed' && !preceding.pending.length ? 'ready' : 'waiting';
}
