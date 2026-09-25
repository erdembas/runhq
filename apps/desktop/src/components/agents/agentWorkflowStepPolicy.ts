import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { CreateWorkflowStep, WorkflowContext } from '@/lib/ipc/agentWorkflowIpc';
import {
  workflowAncestors,
  workflowConcurrentProducerPairs,
  workflowRoleProduces,
  workflowRoleReviews,
  workflowRoleUsesAgent,
  workflowTopologicalOrder,
  workflowUnreviewedProducers,
} from './agentWorkflowGraph';

/** A workflow holds dozens of tasks; the bound exists so one cannot be made unreadable by accident. */
export const MAX_WORKFLOW_STEPS = 512;
export const MAX_WORKFLOW_TASK_PROMPT = 128 * 1024;
/** A task key is typed by hand and repeated in other tasks' dependencies, so it stays short. */
export const WORKFLOW_TASK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const WORKFLOW_ROLE_LABELS: Record<string, string> = {
  plan: 'plan',
  implement: 'implementation',
  review: 'review',
  revise: 'revision',
  validate: 'validation',
  shell: 'shell',
  human: 'human',
  barrier: 'barrier',
};

export const WORKFLOW_ROLE_OPTIONS = [
  {
    value: 'human',
    get label() {
      return i18n.t('Human approval');
    },
  },
  {
    value: 'barrier',
    get label() {
      return i18n.t('Completion gate');
    },
  },
  {
    value: 'shell',
    get label() {
      return i18n.t('Terminal command');
    },
  },
  {
    value: 'plan',
    get label() {
      return i18n.t('Plan');
    },
  },
  {
    value: 'implement',
    get label() {
      return i18n.t('Implement');
    },
  },
  {
    value: 'review',
    get label() {
      return i18n.t('Review');
    },
  },
  {
    value: 'revise',
    get label() {
      return i18n.t('Revise');
    },
  },
  {
    value: 'validate',
    get label() {
      return i18n.t('Validate');
    },
  },
];

export { workflowRoleProduces, workflowRoleReviews, workflowRoleUsesAgent };

/**
 * Something about a declared task list that has to be said before it can run.
 *
 * A problem names the task it is about, so the row itself can carry it rather than a single message
 * at the bottom of a list of thirty. A `fix` is offered where there is one obvious repair.
 */
export interface WorkflowTaskProblem {
  taskId: string | null;
  message: string;
  severity: 'error' | 'warning';
  fix?: 'isolate-concurrent-producers';
}

/**
 * Whether a declared division of labour can run at all, in the words the screen shows.
 *
 * The same rules are enforced again when the workflow is created, because a screen is not a
 * boundary. These say them early, and against the task they belong to.
 */
export function workflowTasksProblems(
  tasks: CreateWorkflowStep[],
  context?: WorkflowContext | null,
): WorkflowTaskProblem[] {
  const direct = context?.workspace_mode === 'direct';
  const problems: WorkflowTaskProblem[] = [];
  const error = (taskId: string | null, message: string, fix?: WorkflowTaskProblem['fix']) =>
    problems.push({ taskId, message, severity: 'error', ...(fix ? { fix } : {}) });
  if (!tasks.length) {
    error(null, i18n.t('Add at least one task.'));
    return problems;
  }
  if (tasks.length > MAX_WORKFLOW_STEPS)
    error(
      null,
      i18n.t('A workflow holds up to {MAX_WORKFLOW_STEPS} tasks.', {
        MAX_WORKFLOW_STEPS: MAX_WORKFLOW_STEPS,
      }),
    );
  const seen = new Set<string>();
  for (const task of tasks) {
    const id = task.id?.trim() ?? '';
    if (!WORKFLOW_TASK_ID.test(id)) {
      error(
        id || null,
        i18n.t(
          '{value1} needs a key of up to 64 lowercase letters, digits, dashes or underscores.',
          { value1: id ? `“${id}”` : i18n.t('Every task') },
        ),
      );
      continue;
    }
    if (seen.has(id))
      error(id, i18n.t('Two tasks use the key “{id}”; keys must be unique.', { id: id }));
    seen.add(id);
    if (!task.prompt.trim() && workflowRoleUsesAgent(task.role))
      error(id, i18n.t('“{id}” has no instruction.', { id: id }));
    if (task.prompt.length > MAX_WORKFLOW_TASK_PROMPT)
      error(id, i18n.t('The instruction for “{id}” is too long.', { id: id }));
    if (task.role === 'shell' && (!task.execution?.command?.trim() || task.workspace === 'own'))
      error(id, i18n.t('A terminal step needs a command and the shared working copy.'));
    if (task.execution?.run_if && !task.depends_on.includes(task.execution.run_if.step_id))
      error(id, i18n.t('A condition must refer to a direct dependency.'));
    if (workflowRoleUsesAgent(task.role) && !task.target)
      error(id, i18n.t('“{id}” needs an account.', { id: id }));
    if (direct && task.workspace === 'own')
      error(
        id,
        i18n.t('“{id}” must use the shared working directory in a direct workflow.', { id }),
      );
    if (task.workspace === 'own' && !workflowRoleProduces(task.role))
      error(
        id,
        i18n.t('“{id}” reads the work rather than producing it, so it runs where it reviews.', {
          id: id,
        }),
      );
    const execution = task.execution;
    if (
      (execution?.agent_profile?.length ?? 0) > 256 ||
      (workflowRoleReviews(task.role) && execution?.agent_profile) ||
      [
        execution?.success_regex,
        execution?.failure_regex,
        execution?.verdict_regex,
        execution?.result_line_regex,
      ].some((pattern) => (pattern?.length ?? 0) > 4096)
    )
      error(id, i18n.t('“{id}” has invalid execution settings.', { id }));
    if (
      execution?.max_runs !== undefined &&
      (!Number.isInteger(execution.max_runs) || execution.max_runs < 1 || execution.max_runs > 100)
    )
      error(id, i18n.t('“{id}” has invalid execution settings.', { id }));
    for (const condition of [
      execution?.run_condition,
      execution?.complete_condition,
      execution?.halt_condition,
    ]) {
      if (!condition) continue;
      for (const reference of condition.matchAll(
        /([a-z0-9][a-z0-9_-]*)\.(?:verdict|runCount|status)\b/g,
      ))
        if (!tasks.some((entry) => entry.id === reference[1]))
          error(id, i18n.t('“{id}” has invalid execution settings.', { id }));
    }
    if (execution?.rerun_step && !workflowAncestors(tasks, id).has(execution.rerun_step))
      error(id, i18n.t('A repeat target must be an earlier dependency.'));
    if (execution?.require_pass?.some((required) => !workflowAncestors(tasks, id).has(required)))
      error(id, i18n.t('Required PASS steps must be earlier dependencies.'));
    for (const dependency of task.depends_on) {
      if (dependency === id) error(id, i18n.t('“{id}” cannot depend on itself.', { id: id }));
      else if (!tasks.some((other) => other.id === dependency))
        error(
          id,
          i18n.t('“{id}” depends on “{dependency}”, which is not a task here.', {
            id: id,
            dependency: dependency,
          }),
        );
    }
  }
  const { cycle } = workflowTopologicalOrder(tasks);
  if (cycle)
    error(
      null,
      i18n.t('{value1} depend on each other.', {
        value1: cycle.map((id) => `“${id}”`).join(' → '),
      }),
    );
  if (problems.some((problem) => problem.severity === 'error')) return problems;

  const continued = new Set<string>();
  for (const task of tasks) {
    if (!task.continue_from) continue;
    const previous = tasks.find((step) => step.id === task.continue_from);
    if (
      !workflowRoleProduces(task.role) ||
      !workflowRoleUsesAgent(task.role) ||
      task.workspace === 'own'
    )
      error(
        task.id,
        i18n.t(
          '“{value1}” can only continue a conversation as a work step in the shared working copy.',
          { value1: task.id },
        ),
      );
    if (
      !previous ||
      !workflowRoleProduces(previous.role) ||
      !workflowRoleUsesAgent(previous.role) ||
      previous.workspace === 'own' ||
      !workflowAncestors(tasks, task.id).has(previous.id)
    )
      error(
        task.id,
        i18n.t('“{value1}” needs an earlier prompt in the shared working copy to continue.', {
          value1: task.id,
        }),
      );
    else if (previous.target !== task.target)
      error(
        task.id,
        i18n.t('“{value1}” must use the same agent as “{value2}” to continue its conversation.', {
          value1: task.id,
          value2: previous.id,
        }),
      );
    if (continued.has(task.continue_from))
      error(
        task.id,
        i18n.t(
          '“{value1}” has two conversation continuations. Chain them in order or use separate conversations.',
          { value1: task.continue_from },
        ),
      );
    continued.add(task.continue_from);
  }

  for (const task of tasks) {
    if (!direct && !task.depends_on.length && workflowRoleReviews(task.role))
      error(
        task.id,
        i18n.t(
          '“{value1}” reviews work that nothing has produced yet; give it a dependency or change its role.',
          { value1: task.id },
        ),
      );
    if (!direct && workflowRoleReviews(task.role)) {
      const ancestors = workflowAncestors(tasks, task.id);
      if (
        ![...ancestors].some((id) => tasks.some((o) => o.id === id && workflowRoleProduces(o.role)))
      )
        error(
          task.id,
          i18n.t('“{value1}” has nothing to read; make it depend on a task that produces work.', {
            value1: task.id,
          }),
        );
    }
  }
  const producers = tasks.filter((task) => workflowRoleProduces(task.role));
  const gating = tasks.some(
    (task) =>
      task.role === 'review' &&
      task.workspace !== 'own' &&
      producers.every((producer) => workflowAncestors(tasks, task.id).has(producer.id)),
  );
  if (!direct && !gating)
    error(
      null,
      i18n.t(
        'Add an independent review of the finished work: a review in the shared checkout that depends on every task that produces.',
      ),
    );
  for (const id of direct ? [] : workflowUnreviewedProducers(tasks))
    error(id, i18n.t('“{id}” is never reviewed; make a review task depend on it.', { id: id }));
  // Two producing tasks with nothing between them will be started together, and one checkout never
  // carries two agents — so either they each get their own, or they cannot both run.
  for (const [left, right] of direct ? [] : workflowConcurrentProducerPairs(tasks)) {
    const a = tasks.find((task) => task.id === left);
    const b = tasks.find((task) => task.id === right);
    if (
      a?.workspace !== 'own' &&
      b?.workspace !== 'own' &&
      !(a?.execution?.lock && a.execution.lock === b?.execution?.lock)
    )
      error(
        right,
        i18n.t(
          '“{left}” and “{right}” can run at the same time and both write the shared checkout.',
          { left: left, right: right },
        ),
        'isolate-concurrent-producers',
      );
    else if (a?.workspace === 'own' && b?.workspace === 'own')
      problems.push({
        taskId: right,
        message: i18n.t(
          'Results from “{left}” and “{right}” are applied one after the other; a disagreement between them is reported, not merged.',
          { left: left, right: right },
        ),
        severity: 'warning',
      });
  }
  return problems;
}

/** The first thing that stops this list running, for callers that want one line. */
export function workflowStepsProblem(
  tasks: CreateWorkflowStep[],
  context?: WorkflowContext | null,
): string | null {
  return workflowTasksProblems(tasks, context).find((p) => p.severity === 'error')?.message ?? null;
}

/** Give every producing task that could run beside another one a checkout of its own. */
export function isolateConcurrentProducers(tasks: CreateWorkflowStep[]): CreateWorkflowStep[] {
  const concurrent = new Set(workflowConcurrentProducerPairs(tasks).flat());
  return tasks.map((task) =>
    concurrent.has(task.id) && workflowRoleProduces(task.role)
      ? { ...task, workspace: 'own' as const }
      : task,
  );
}

/** A key for a new task: its own first words when they make one, else `t1`, `t2`, … */
export function workflowTaskId(prompt: string, taken: Set<string>): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  if (WORKFLOW_TASK_ID.test(slug) && !taken.has(slug)) return slug;
  for (let index = 1; ; index += 1) {
    const id = `t${index}`;
    if (!taken.has(id)) return id;
  }
}

export function moveWorkflowStep<T>(steps: T[], index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** A collapsed row edits the instruction's summary without discarding its remaining lines. */
export function replaceWorkflowTaskSummary(prompt: string, summary: string): string {
  const newline = prompt.indexOf('\n');
  return summary + (newline < 0 ? '' : prompt.slice(newline));
}

export const newWorkflowStep = (
  role: CreateWorkflowStep['role'],
  target: string,
  id: string,
  depends_on: string[] = [],
): CreateWorkflowStep => ({
  id,
  role,
  target: workflowRoleUsesAgent(role) ? target : '',
  model: '',
  effort: '',
  mode: '',
  prompt: '',
  depends_on,
  workspace: 'shared',
  ...(workflowRoleReviews(role) ? { review_policy: 'on_findings' as const } : {}),
});
