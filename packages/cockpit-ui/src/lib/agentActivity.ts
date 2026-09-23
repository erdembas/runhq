import * as i18n from '../i18n/core';
import type { AgentSession } from '@runhq/cockpit-types';

export interface AgentActivitySummary {
  working: number;
  starting: number;
  waiting: number;
  issues: number;
  unread: number;
  stopping: number;
  targetSessionId?: string;
  targetProjectId?: string;
}

/** One session contributes to one state. A pending decision always takes precedence. */
export function summarizeAgentActivity(sessions: Iterable<AgentSession>): AgentActivitySummary {
  const summary: AgentActivitySummary = {
    working: 0,
    starting: 0,
    waiting: 0,
    issues: 0,
    unread: 0,
    stopping: 0,
  };
  const seen = new Set<string>();
  let targetPriority = Infinity;
  let targetUpdatedAt = -Infinity;
  for (const session of sessions) {
    if (session.archived || seen.has(session.id)) continue;
    seen.add(session.id);
    let priority = Infinity;
    if (
      session.pending.length > 0 ||
      session.status === 'waiting_input' ||
      session.status === 'waiting_permission'
    ) {
      summary.waiting++;
      priority = 0;
    } else if (session.status === 'failed' || session.status === 'interrupted') {
      summary.issues++;
      priority = 1;
    } else if (session.status === 'completed' && session.unread) {
      summary.unread++;
      priority = 2;
    } else if (session.status === 'running') {
      summary.working++;
      priority = 3;
    } else if (session.status === 'starting') {
      summary.starting++;
      priority = 3;
    } else if (session.status === 'cancelling') {
      summary.stopping++;
      priority = 4;
    }
    if (
      Number.isFinite(priority) &&
      (priority < targetPriority ||
        (priority === targetPriority && session.updated_at > targetUpdatedAt))
    ) {
      summary.targetSessionId = session.id;
      summary.targetProjectId = session.project_id;
      targetPriority = priority;
      targetUpdatedAt = session.updated_at;
    }
  }
  return summary;
}

export function agentActivityLabel(summary: AgentActivitySummary): string {
  return [
    summary.working ? i18n.t('{value1} working', { value1: summary.working }) : '',
    summary.starting ? i18n.t('{value1} starting', { value1: summary.starting }) : '',
    summary.waiting
      ? i18n.t('{value1} waiting for your decision', { value1: summary.waiting })
      : '',
    summary.issues ? i18n.t('{value1} failed or interrupted', { value1: summary.issues }) : '',
    summary.unread
      ? i18n.t('{value1} unread completed {value2}', {
          value1: summary.unread,
          value2: summary.unread === 1 ? i18n.t('response') : i18n.t('responses'),
        })
      : '',
    summary.stopping ? i18n.t('{value1} stopping', { value1: summary.stopping }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
