import type { AgentProject, AgentSession } from '@runhq/cockpit-types';

function normalizedPath(path: string) {
  return path.replace(/\/+$/, '');
}

/** Isolated tasks keep their project identity even when cwd is a worktree. */
export function recentProjectTasks(
  cwd: string,
  projects: AgentProject[],
  sessions: Record<string, AgentSession>,
) {
  const path = normalizedPath(cwd);
  const projectIds = new Set(
    projects
      .filter((project) => normalizedPath(project.path) === path)
      .map((project) => project.id),
  );
  return Object.values(sessions)
    .filter(
      (session) =>
        !session.archived &&
        (projectIds.has(session.project_id) || normalizedPath(session.cwd) === path),
    )
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);
}
