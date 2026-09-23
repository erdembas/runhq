import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { AgentRequest, AgentSession } from '@runhq/cockpit-types';

export interface AgentDecision {
  key: string;
  session: AgentSession;
  request: AgentRequest;
  since: number;
}

export const agentDecisionKey = (sessionId: string, requestId: string) =>
  JSON.stringify([sessionId, requestId]);

export function collectAgentDecisions(
  sessions: Record<string, AgentSession>,
  since: Record<string, number>,
  filter: { projectId?: string; kind?: string; search?: string } = {},
): AgentDecision[] {
  const search = filter.search?.trim().toLocaleLowerCase() ?? '';
  return Object.values(sessions)
    .flatMap((session) => {
      if (filter.projectId && filter.projectId !== session.project_id) return [];
      return session.pending
        .filter(
          (request) =>
            (!filter.kind || filter.kind === 'all' || request.kind === filter.kind) &&
            (!search ||
              `${session.title} ${session.project_name} ${request.title}`
                .toLocaleLowerCase()
                .includes(search)),
        )
        .map((request) => ({
          key: agentDecisionKey(session.id, request.id),
          session,
          request,
          since: since[agentDecisionKey(session.id, request.id)] ?? session.updated_at,
        }));
    })
    .sort((left, right) => left.since - right.since || left.key.localeCompare(right.key));
}

export function agentDecisionWait(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return i18n.t('{seconds}s', { seconds });
  if (seconds < 3600) return i18n.t('{value1}m', { value1: Math.floor(seconds / 60) });
  if (seconds < 86400)
    return i18n.t('{value1}h {value2}m', {
      value1: Math.floor(seconds / 3600),
      value2: Math.floor((seconds % 3600) / 60),
    });
  return i18n.t('{value1}d {value2}h', {
    value1: Math.floor(seconds / 86400),
    value2: Math.floor((seconds % 86400) / 3600),
  });
}
