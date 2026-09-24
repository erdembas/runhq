import type { AgentItem, AgentProject, ServiceDef, StackDef } from '@runhq/cockpit-types';
import { parseAgentChanges } from '@/components/agents/agentChanges';

export const workspaceStackId = (projectId: string) => `workspace:${projectId}`;

export function workspaceRunPlanValid(
  project: AgentProject,
  stack: StackDef,
  services: ServiceDef[],
) {
  if (!stack.service_ids.length) return false;
  return stack.service_ids.every((id) => {
    const member = project.workspace?.members.find((entry) => entry.service_id === id);
    const service = services.find((entry) => entry.id === id);
    if (!member || !service) return false;
    const names = stack.command_names?.[id] ?? service.cmds.map((command) => command.name);
    return (
      names.length > 0 &&
      names.every((name) => service.cmds.some((command) => command.name === name))
    );
  });
}

export function workspaceChangeTotals(diff: string) {
  const files = parseAgentChanges(diff);
  return {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

/** Provider evidence, never an assertion that RunHQ independently executed a test. */
export function workspaceCheckEvidence(items: AgentItem[]) {
  return items
    .filter(
      (item) =>
        (item.kind === 'command' || item.kind === 'tool') &&
        /\b(test|tests|pytest|vitest|jest|typecheck|lint|cargo check|tsc|check)\b/i.test(
          `${item.title}\n${item.text}`,
        ),
    )
    .slice(-8);
}
