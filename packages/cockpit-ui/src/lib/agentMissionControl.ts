import type { AgentSession } from '@runhq/cockpit-types';

export type AgentTaskLane = 'attention' | 'working' | 'ready' | 'completed';

/** Pending requests take precedence so an agent never disappears into a running lane. */
export function agentTaskLane(session: AgentSession): AgentTaskLane {
  if (
    session.pending.length > 0 ||
    ['waiting_input', 'waiting_permission', 'failed', 'interrupted'].includes(session.status)
  )
    return 'attention';
  if (['starting', 'running', 'cancelling'].includes(session.status)) return 'working';
  if (session.status === 'completed') return 'completed';
  return 'ready';
}

export function groupAgentTasks(sessions: AgentSession[]): Record<AgentTaskLane, AgentSession[]> {
  const groups: Record<AgentTaskLane, AgentSession[]> = {
    attention: [],
    working: [],
    ready: [],
    completed: [],
  };
  for (const session of sessions) groups[agentTaskLane(session)].push(session);
  for (const tasks of Object.values(groups)) {
    tasks.sort((a, b) => Number(b.unread) - Number(a.unread) || b.updated_at - a.updated_at);
  }
  return groups;
}
