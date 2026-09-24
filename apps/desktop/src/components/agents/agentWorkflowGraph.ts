import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { WorkflowStep } from '@/lib/ipc/agentWorkflowIpc';

/**
 * Reading a workflow's tasks as the graph they are.
 *
 * A linear list could be read top to bottom; a graph cannot. These helpers answer the questions the
 * screen actually asks — what could start now, what is this task waiting for, how much does it hold
 * up, and where does everything sit — from the tasks alone, so the same answers hold wherever they
 * are shown and can be tested without a screen.
 */

/** Tasks as a lookup, so a dependency name can be resolved without scanning the list again. */
export function workflowTaskIndex<T extends { id: string }>(tasks: T[]): Map<string, T> {
  return new Map(tasks.map((task) => [task.id, task]));
}

/** For each task, the tasks that name it — what this one is holding up. */
export function workflowDependents<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
): Record<string, string[]> {
  const dependents: Record<string, string[]> = Object.fromEntries(
    tasks.map((task) => [task.id, [] as string[]]),
  );
  for (const task of tasks)
    for (const dependency of task.depends_on) dependents[dependency]?.push(task.id);
  return dependents;
}

/**
 * An order in which every task follows the ones it depends on, or the cycle that prevents one.
 *
 * The cycle is returned rather than thrown because the screen names it back to the person: a cycle
 * is something they drew, and they need to be told which tasks it runs through.
 */
export function workflowTopologicalOrder<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
): { order: string[]; cycle: string[] | null } {
  const index = workflowTaskIndex(tasks);
  const done = new Set<string>();
  const path: string[] = [];
  const open = new Set<string>();
  const order: string[] = [];
  let cycle: string[] | null = null;
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (open.has(id)) {
      cycle = [...path.slice(path.indexOf(id)), id];
      return false;
    }
    const task = index.get(id);
    if (!task) return true;
    open.add(id);
    path.push(id);
    for (const dependency of task.depends_on) if (!visit(dependency)) return false;
    path.pop();
    open.delete(id);
    done.add(id);
    order.push(id);
    return true;
  };
  for (const task of tasks) if (!visit(task.id)) return { order: [], cycle };
  return { order, cycle: null };
}

/** The editor can show any row order; persisted workflows declare dependencies first. */
export function workflowTasksInExecutionOrder<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
): T[] {
  const index = workflowTaskIndex(tasks);
  if (index.size !== tasks.length) throw new Error(i18n.t('Workflow task keys must be unique.'));
  for (const task of tasks)
    for (const dependency of task.depends_on)
      if (!index.has(dependency))
        throw new Error(
          i18n.t('Task “{value1}” depends on unknown task “{dependency}”.', {
            value1: task.id,
            dependency: dependency,
          }),
        );
  const { order, cycle } = workflowTopologicalOrder(tasks);
  if (cycle)
    throw new Error(
      i18n.t('Workflow tasks depend on each other: {value1}.', { value1: cycle.join(' → ') }),
    );
  return order.map((id) => index.get(id)!);
}

/** How far each task sits from a task that waits for nothing — the column it is drawn in. */
export function workflowTaskLevels<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
): Record<string, number> {
  const index = workflowTaskIndex(tasks);
  const levels: Record<string, number> = {};
  const seen = new Set<string>();
  const level = (id: string): number => {
    if (levels[id] !== undefined) return levels[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const task = index.get(id);
    const depth = task?.depends_on.length
      ? Math.max(...task.depends_on.map((dependency) => level(dependency) + 1))
      : 0;
    levels[id] = depth;
    return depth;
  };
  for (const task of tasks) level(task.id);
  return levels;
}

/** Everything a task waits for, directly or through another task. */
export function workflowAncestors<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
  id: string,
): Set<string> {
  const index = workflowTaskIndex(tasks);
  const seen = new Set<string>();
  const pending = [...(index.get(id)?.depends_on ?? [])];
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(index.get(next)?.depends_on ?? []));
  }
  return seen;
}

/** Everything that waits for a task, directly or through another task. */
export function workflowDescendants<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
  id: string,
): Set<string> {
  const dependents = workflowDependents(tasks);
  const seen = new Set<string>();
  const pending = [...(dependents[id] ?? [])];
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(dependents[next] ?? []));
  }
  return seen;
}

/**
 * Whether making `task` depend on `dependency` would create a cycle.
 *
 * The dependency picker uses this to draw an impossible choice as unavailable, so a cycle is never
 * something the person has to be told about after the fact.
 */
export function workflowWouldCycle<T extends { id: string; depends_on: string[] }>(
  tasks: T[],
  taskId: string,
  dependency: string,
): boolean {
  if (taskId === dependency) return true;
  return workflowDescendants(tasks, taskId).has(dependency);
}

/** Tasks that produce changes; the rest read the checkout and report. */
export const workflowRoleProduces = (role: string) =>
  role === 'plan' || role === 'implement' || role === 'revise' || role === 'shell';

/** The dependencies of a task that have not finished, in the words the card shows. */
export function workflowBlockedBy(steps: WorkflowStep[], id: string): string[] {
  const index = workflowTaskIndex(steps);
  const step = index.get(id);
  if (!step) return [];
  return step.depends_on.filter((dependency) => {
    const other = index.get(dependency);
    if (!other) return true;
    if (other.status !== 'completed') return true;
    return workflowAwaitingJoin(other) || workflowReviewNeedsDecision(other);
  });
}

/** Whether a task's result is finished but has not yet been applied to the shared checkout. */
export function workflowAwaitingJoin(step: WorkflowStep): boolean {
  return (
    step.result?.outcome !== 'skipped' &&
    workflowRoleProduces(step.role) &&
    step.workspace === 'own' &&
    step.status === 'completed' &&
    step.merge?.status !== 'applied' &&
    step.merge?.status !== 'empty'
  );
}

/** Tasks that could start now: waiting, with everything they depend on finished and landed. */
export function workflowRunnableTasks(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.filter(
    (step) => step.status === 'pending' && workflowBlockedBy(steps, step.id).length === 0,
  );
}

export type WorkflowTaskLane = 'blocked' | 'attention' | 'working' | 'ready' | 'completed';

export function workflowReviewNeedsDecision(step: WorkflowStep) {
  return (
    step.status === 'completed' &&
    !workflowRoleProduces(step.role) &&
    !!step.review_policy &&
    step.review_policy !== 'continue' &&
    !step.review_decision &&
    (step.review_policy === 'approval' || step.review_outcome !== 'passed')
  );
}

/**
 * Which lane a task belongs in.
 *
 * A task whose agent is waiting on the person comes first even while it is technically running,
 * because that is the one thing only they can move — the same rule Mission Control uses for tasks.
 */
export function workflowTaskLane(
  step: WorkflowStep,
  session?: { status: string; pending: unknown[] },
  /** Whether a waiting task could start now. A task cannot tell on its own; the list decides. */
  runnable = false,
): WorkflowTaskLane {
  if (
    workflowReviewNeedsDecision(step) ||
    step.status === 'failed' ||
    step.status === 'blocked' ||
    step.merge?.status === 'conflict' ||
    (session &&
      (session.pending.length > 0 ||
        ['waiting_input', 'waiting_permission', 'failed', 'interrupted'].includes(session.status)))
  )
    return 'attention';
  if (step.status === 'running') return 'working';
  if (step.status === 'completed') return 'completed';
  return runnable ? 'ready' : 'blocked';
}

/** Every task's lane, decided against the whole list. */
export function groupWorkflowTasks(
  steps: WorkflowStep[],
  sessions: Record<string, { status: string; pending: unknown[] } | undefined> = {},
): Record<WorkflowTaskLane, WorkflowStep[]> {
  const lanes: Record<WorkflowTaskLane, WorkflowStep[]> = {
    attention: [],
    working: [],
    ready: [],
    blocked: [],
    completed: [],
  };
  const runnable = new Set(workflowRunnableTasks(steps).map((step) => step.id));
  for (const step of steps) {
    const session = step.session_id ? sessions[step.session_id] : undefined;
    lanes[workflowTaskLane(step, session, runnable.has(step.id))].push(step);
  }
  return lanes;
}

/** The one-line summary the run view shows instead of a stage name. */
export function workflowProgress(
  steps: WorkflowStep[],
  sessions: Record<string, { status: string; pending: unknown[] } | undefined> = {},
) {
  const lanes = groupWorkflowTasks(steps, sessions);
  return {
    total: steps.length,
    blocked: lanes.blocked.length,
    attention: lanes.attention.length,
    working: lanes.working.length,
    ready: lanes.ready.length,
    completed: lanes.completed.length,
  };
}

/** Producing tasks that no review reads, which is what would leave work unreviewed. */
export function workflowUnreviewedProducers<
  T extends { id: string; role: string; depends_on: string[]; workspace?: string },
>(tasks: T[]): string[] {
  const reviews = tasks.filter((task) => !workflowRoleProduces(task.role));
  const reviewed = new Set<string>();
  for (const review of reviews)
    for (const ancestor of workflowAncestors(tasks, review.id)) reviewed.add(ancestor);
  return tasks
    .filter((task) => workflowRoleProduces(task.role) && !reviewed.has(task.id))
    .map((task) => task.id);
}

/** Pairs of producing tasks that could run at the same time, neither waiting for the other. */
export function workflowConcurrentProducerPairs<
  T extends { id: string; role: string; depends_on: string[] },
>(tasks: T[]): [string, string][] {
  const producers = tasks.filter((task) => workflowRoleProduces(task.role));
  const pairs: [string, string][] = [];
  const ancestors = new Map(producers.map((task) => [task.id, workflowAncestors(tasks, task.id)]));
  for (let left = 0; left < producers.length; left += 1)
    for (let right = left + 1; right < producers.length; right += 1) {
      const a = producers[left]!;
      const b = producers[right]!;
      if (!ancestors.get(a.id)!.has(b.id) && !ancestors.get(b.id)!.has(a.id))
        pairs.push([a.id, b.id]);
    }
  return pairs;
}

/** How often to ask for fresh state: often while agents are moving, rarely while nothing is. */
export function workflowPollInterval(
  workflows: { steps: WorkflowStep[]; stage: string }[],
): number {
  const busy = workflows.some(
    (workflow) =>
      workflow.steps.some((step) => step.status === 'running') ||
      [
        'waiting',
        'launching',
        'implementing',
        'reviewing',
        'checking',
        'setting_up',
        'integrating',
      ].includes(workflow.stage),
  );
  return busy ? 1500 : 5000;
}

/** The review sessions whose findings are worth showing: the most recent ones that finished. */
export function reviewSessionIds(steps: WorkflowStep[], limit = 3): string[] {
  return steps
    .filter(
      (step) => !workflowRoleProduces(step.role) && step.status === 'completed' && step.session_id,
    )
    .sort((left, right) => (right.finished_at ?? 0) - (left.finished_at ?? 0))
    .slice(0, limit)
    .map((step) => step.session_id!)
    .filter(Boolean);
}
