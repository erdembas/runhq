import type { AgentSession } from '@runhq/cockpit-types';

export type AgentNotificationKind = 'blocked' | 'failed' | 'completed';
export interface AgentNotificationEvent {
  sessionId: string;
  projectId: string;
  kind: AgentNotificationKind;
}
export interface AgentNotificationPreferences {
  enabled: boolean;
  mutedProjects: string[];
}

export function readAgentNotificationPreferences(raw: string | null): AgentNotificationPreferences {
  const fallback = { enabled: false, mutedProjects: [] };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      typeof value.enabled !== 'boolean' ||
      !Array.isArray(value.mutedProjects) ||
      !value.mutedProjects.every((id: unknown) => typeof id === 'string')
    )
      return fallback;
    return { enabled: value.enabled, mutedProjects: [...new Set<string>(value.mutedProjects)] };
  } catch {
    return fallback;
  }
}

const waiting = (session: AgentSession) =>
  session.pending.length > 0 ||
  session.status === 'waiting_input' ||
  session.status === 'waiting_permission';

/** Seed without alerts on startup/import. Only meaningful transitions emit events. */
export function createAgentNotificationTracker() {
  let previous: Record<string, AgentSession> | null = null;
  return (sessions: Record<string, AgentSession>, ready: boolean): AgentNotificationEvent[] => {
    if (!ready) {
      previous = null;
      return [];
    }
    const before = previous;
    previous = sessions;
    if (!before || before === sessions) return [];
    const events: AgentNotificationEvent[] = [];
    for (const session of Object.values(sessions)) {
      const old = before[session.id];
      if (!old || session.archived || old.archived || old.revision >= session.revision) continue;
      let kind: AgentNotificationKind | undefined;
      if (waiting(session)) {
        const newRequest = session.pending.some(
          (request) => !old.pending.some((previous) => previous.id === request.id),
        );
        if (!waiting(old) || (old.pending.length > 0 && newRequest)) kind = 'blocked';
      } else if (session.status !== old.status) {
        if (session.status === 'failed' || session.status === 'interrupted') kind = 'failed';
        else if (session.status === 'completed' && session.unread) kind = 'completed';
      }
      if (kind) events.push({ kind, sessionId: session.id, projectId: session.project_id });
    }
    return events;
  };
}

export function relevantAgentNotifications(
  events: AgentNotificationEvent[],
  sessions: Record<string, AgentSession>,
  preferences: AgentNotificationPreferences,
  viewedSessionId?: string | null,
): AgentNotificationEvent[] {
  if (!preferences.enabled) return [];
  const seen = new Set<string>();
  return events.filter((event) => {
    const session = sessions[event.sessionId];
    if (
      !session ||
      session.archived ||
      preferences.mutedProjects.includes(event.projectId) ||
      viewedSessionId === session.id ||
      seen.has(session.id)
    )
      return false;
    const relevant =
      event.kind === 'blocked'
        ? waiting(session)
        : event.kind === 'failed'
          ? session.status === 'failed' || session.status === 'interrupted'
          : session.status === 'completed' && session.unread;
    if (relevant) seen.add(session.id);
    return relevant;
  });
}

/** Deliberately contains no project, task, prompt, request or error content. */
export function agentNotificationMessage(events: AgentNotificationEvent[]) {
  const counts = { blocked: 0, failed: 0, completed: 0 };
  for (const event of events) counts[event.kind]++;
  const parts = [
    counts.blocked
      ? `${counts.blocked} ${counts.blocked === 1 ? 'task needs' : 'tasks need'} your decision`
      : '',
    counts.failed
      ? `${counts.failed} ${counts.failed === 1 ? 'task needs' : 'tasks need'} recovery`
      : '',
    counts.completed
      ? `${counts.completed} ${counts.completed === 1 ? 'task has' : 'tasks have'} a new response`
      : '',
  ].filter(Boolean);
  return { title: 'RunHQ Agents', body: `${parts.join(' · ')}. Open Agents to review.` };
}
