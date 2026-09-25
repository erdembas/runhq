import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import { workflowRoleUsesAgent } from './agentWorkflowGraph';

export type WorkflowRoleModelSettings = Pick<CreateWorkflowStep, 'target' | 'model' | 'effort'>;

export const workflowModelSettings = (step: CreateWorkflowStep): WorkflowRoleModelSettings => ({
  target: step.target,
  model: step.model,
  effort: step.effort,
});

/** Only overwrite agent settings; imported commands, gates and review policies remain intact. */
export function applyWorkflowRoleModels(
  steps: CreateWorkflowStep[],
  role: CreateWorkflowStep['role'],
  settings: WorkflowRoleModelSettings,
  locked: ReadonlySet<string> = new Set(),
): CreateWorkflowStep[] {
  if (!workflowRoleUsesAgent(role)) return steps;
  const changedTargets = new Set<string>();
  const next = steps.map((step) => {
    if (step.role !== role || locked.has(step.id)) return step;
    const targetChanged = step.target !== settings.target;
    if (targetChanged) changedTargets.add(step.id);
    return {
      ...step,
      ...settings,
      ...(targetChanged && step.execution?.agent_profile
        ? { execution: { ...step.execution, agent_profile: '' } }
        : {}),
    };
  });
  const byId = new Map(next.map((step) => [step.id, step]));
  return next.map((step) => {
    if (locked.has(step.id) || !step.continue_from) return step;
    const source = byId.get(step.continue_from);
    // Keep chains when both ends switch together, but never resume another account's
    // session across roles or an already-started step.
    return source &&
      source.target !== step.target &&
      (changedTargets.has(step.id) || changedTargets.has(source.id))
      ? { ...step, continue_from: undefined }
      : step;
  });
}
