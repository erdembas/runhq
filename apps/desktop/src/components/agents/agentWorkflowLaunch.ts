import type { AgentSession } from '@runhq/cockpit-types';
import { agentIsActive } from '@runhq/cockpit-ui';

export type WorkflowLaunchChoice =
  { mode: 'now' } | { mode: 'after'; sessionId: string } | { mode: 'draft' };

export function workflowLaunchCandidates(
  sessions: Record<string, AgentSession | undefined>,
  projectId: string,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);
  return Object.values(sessions)
    .filter(
      (session): session is AgentSession =>
        !!session &&
        session.project_id === projectId &&
        !session.archived &&
        agentIsActive(session.status) &&
        session.status !== 'cancelling' &&
        !excluded.has(session.id),
    )
    .sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
}
