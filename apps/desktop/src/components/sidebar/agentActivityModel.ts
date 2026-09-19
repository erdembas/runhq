import type { AgentProject, AgentSession, ServiceDef } from '@runhq/cockpit-types';
import { summarizeAgentActivity } from '@runhq/cockpit-ui';

// Canonical project paths come from the backend; normalize separators without
// conflating names, sibling directories, or case-sensitive filesystem paths.
export const agentProjectPathKey = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';

/** Transcript revisions must not repaint every sidebar row on every token. */
export function createAgentActivitySelector() {
  let previous: Record<string, AgentSession> = {};
  return ({ sessions }: { sessions: Record<string, AgentSession> }) => {
    if (sessions === previous) return previous;
    const ids = Object.keys(sessions);
    if (
      ids.length === Object.keys(previous).length &&
      ids.every((id) => {
        const before = previous[id];
        const after = sessions[id]!;
        return (
          before &&
          before.project_id === after.project_id &&
          before.status === after.status &&
          before.archived === after.archived &&
          before.unread === after.unread &&
          before.pending.length === after.pending.length
        );
      })
    )
      return previous;
    previous = sessions;
    return sessions;
  };
}

export function buildSidebarAgentActivity(
  projects: AgentProject[],
  services: ServiceDef[],
  sessions: Record<string, AgentSession>,
  resolvedProjectIds: Record<string, string> = {},
) {
  const projectByPath = new Map(
    projects.map((project) => [agentProjectPathKey(project.path), project.id]),
  );
  const projectByService = new Map<string, string>();
  for (const service of services) {
    const key = agentProjectPathKey(service.cwd);
    const projectId = resolvedProjectIds[key] ?? projectByPath.get(key);
    if (projectId) projectByService.set(service.id, projectId);
  }
  const sessionsByProject = new Map<string, AgentSession[]>();
  for (const session of Object.values(sessions)) {
    if (session.archived) continue;
    const bucket = sessionsByProject.get(session.project_id) ?? [];
    bucket.push(session);
    sessionsByProject.set(session.project_id, bucket);
  }
  return {
    all: summarizeAgentActivity(Object.values(sessions)),
    forServices(serviceIds: Iterable<string>) {
      const projectIds = new Set<string>();
      for (const serviceId of serviceIds) {
        const projectId = projectByService.get(serviceId);
        if (projectId) projectIds.add(projectId);
      }
      return summarizeAgentActivity(
        [...projectIds].flatMap((projectId) => sessionsByProject.get(projectId) ?? []),
      );
    },
  };
}
