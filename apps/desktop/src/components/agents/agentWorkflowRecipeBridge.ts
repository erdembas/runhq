import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import type { AgentRecipeStep } from './agentLibraryModel';

/**
 * Moving a saved division of labour between the two shapes it lives in.
 *
 * A recipe is TypeScript-side data and spells its fields the way the rest of the library does; the
 * workflow contract mirrors Rust. They are close enough that a spread looks like it would work and
 * far enough that it would silently drop the dependencies, so the translation is written out once
 * and tested on its own.
 */
export function recipeStepsToCreateSteps(
  steps: AgentRecipeStep[],
  resolveTarget: (target: string) => string = (target) => target,
): CreateWorkflowStep[] {
  return steps.map((step, index) => ({
    id: step.id?.trim() || `s${index + 1}`,
    role: step.role,
    target: resolveTarget(step.target),
    model: step.model,
    effort: step.effort,
    mode: step.mode,
    prompt: step.prompt ?? '',
    depends_on: step.dependsOn ?? (index > 0 ? [steps[index - 1]!.id ?? `s${index}`] : []),
    workspace: step.workspace ?? 'shared',
  }));
}

export function createStepsToRecipeSteps(steps: CreateWorkflowStep[]): AgentRecipeStep[] {
  return steps.map((step) => ({
    id: step.id,
    role: step.role,
    target: step.target,
    model: step.model,
    effort: step.effort,
    mode: step.mode,
    prompt: step.prompt,
    dependsOn: step.depends_on,
    workspace: step.workspace,
  }));
}
