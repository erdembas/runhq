import type { AgentProject, AgentSession } from '@runhq/cockpit-types';
import { agentTaskLane, agentProviderNames, type AgentTaskLane } from '@runhq/cockpit-ui';

export type AgentDashboardFilter = 'all' | AgentTaskLane;

export function buildAgentDashboard(
  sessions: Record<string, AgentSession>,
  projects: AgentProject[],
  {
    projectId = '',
    query = '',
    filter = 'all',
  }: {
    projectId?: string;
    query?: string;
    filter?: AgentDashboardFilter;
  } = {},
) {
  const active = Object.values(sessions).filter((session) => !session.archived);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  for (const session of active) {
    if (!projectNames.has(session.project_id))
      projectNames.set(session.project_id, session.project_name);
  }
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const scoped = active.filter((session) => {
    if (projectId && session.project_id !== projectId) return false;
    const text = [
      session.title,
      projectNames.get(session.project_id),
      session.backend_name,
      session.backend,
      agentProviderNames[session.backend],
      session.model,
      session.branch,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const counts: Record<AgentTaskLane, number> = {
    attention: 0,
    working: 0,
    ready: 0,
    completed: 0,
  };
  for (const session of scoped) counts[agentTaskLane(session)]++;
  const priority: Record<AgentTaskLane, number> = {
    attention: 0,
    working: 1,
    ready: 2,
    completed: 3,
  };
  const matched = scoped
    .filter((session) => filter === 'all' || agentTaskLane(session) === filter)
    .sort(
      (a, b) =>
        priority[agentTaskLane(a)] - priority[agentTaskLane(b)] ||
        Number(b.unread) - Number(a.unread) ||
        b.updated_at - a.updated_at ||
        a.id.localeCompare(b.id),
    );
  const groups = new Map<string, { id: string; name: string; sessions: AgentSession[] }>();
  for (const session of matched) {
    let group = groups.get(session.project_id);
    if (!group) {
      group = {
        id: session.project_id,
        name: projectNames.get(session.project_id) || 'Untitled project',
        sessions: [],
      };
      groups.set(session.project_id, group);
    }
    group.sessions.push(session);
  }
  return {
    total: active.length,
    scopedTotal: scoped.length,
    matchedTotal: matched.length,
    counts,
    projectOptions: [...projectNames]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    groups: [...groups.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
  };
}
