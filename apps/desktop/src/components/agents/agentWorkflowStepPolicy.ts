import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';

export const MAX_WORKFLOW_STEPS = 8;

export const WORKFLOW_ROLE_LABELS: Record<string, string> = {
  plan: 'plan',
  implement: 'implementation',
  review: 'review',
  revise: 'revision',
  validate: 'validation',
};

export const WORKFLOW_ROLE_OPTIONS = [
  { value: 'plan', label: 'Plan' },
  { value: 'implement', label: 'Implement' },
  { value: 'review', label: 'Review' },
  { value: 'revise', label: 'Revise' },
  { value: 'validate', label: 'Validate' },
];

/** Roles that change the checkout; the rest read it and report, and run read-only. */
export const workflowRoleProduces = (role: string) =>
  role === 'plan' || role === 'implement' || role === 'revise';

/**
 * Whether a declared division of labour can run at all, in the words the screen shows. The same
 * rules are enforced again when the workflow is created, because a screen is not a boundary.
 */
export function workflowStepsProblem(steps: CreateWorkflowStep[]): string | null {
  if (!steps.length) return 'Add at least one step.';
  if (!workflowRoleProduces(steps[0]!.role))
    return 'The first step must produce work; a review has nothing to read before it.';
  if (!steps.some((step) => step.role === 'review'))
    return 'Add an independent review before the work can be integrated.';
  if (steps.some((step) => !step.target)) return 'Every step needs an account.';
  return null;
}

export function moveWorkflowStep<T>(steps: T[], index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

export const newWorkflowStep = (
  role: CreateWorkflowStep['role'],
  target: string,
): CreateWorkflowStep => ({ role, target, model: '', effort: '', mode: '' });
