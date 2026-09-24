import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { CreateWorkflowStep, WorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  workflowAncestors,
  workflowDescendants,
  workflowRoleProduces,
  workflowTaskLevels,
  workflowTasksInExecutionOrder,
  workflowWouldCycle,
} from './agentWorkflowGraph';
import { newWorkflowStep, workflowTaskId } from './agentWorkflowStepPolicy';

export const WORKFLOW_TEMPLATES = [
  {
    id: 'queue',
    get name() {
      return i18n.t('Prompt queue');
    },
    get description() {
      return i18n.t('Run your prompts in order, with reviews wherever you need them.');
    },
  },
  {
    id: 'build',
    get name() {
      return i18n.t('Build & review');
    },
    get description() {
      return i18n.t('Make a change, then get a second opinion.');
    },
  },
  {
    id: 'plan',
    get name() {
      return i18n.t('Plan first');
    },
    get description() {
      return i18n.t('Outline an approach before building.');
    },
  },
  {
    id: 'parallel',
    get name() {
      return i18n.t('Work in parallel');
    },
    get description() {
      return i18n.t('Split the work, then review it together.');
    },
  },
] as const;
export type WorkflowTemplate = (typeof WORKFLOW_TEMPLATES)[number]['id'];

export function createWorkflowTemplate(
  template: WorkflowTemplate,
  producer: string,
  reviewer: string,
): CreateWorkflowStep[] {
  const step = (
    id: string,
    role: CreateWorkflowStep['role'],
    prompt: string,
    dependencies: string[] = [],
  ): CreateWorkflowStep => ({
    ...newWorkflowStep(role, role === 'review' ? reviewer : producer, id, dependencies),
    prompt,
  });
  const review = (dependencies: string[]) =>
    step(
      'review',
      'review',
      'Review the completed work against the brief and success criteria. Report any issues with file references.',
      dependencies,
    );
  if (template === 'queue')
    return createWorkflowPromptQueue(
      [
        { prompt: 'Implement the change described in the brief.', review: true },
        {
          prompt: 'Address the review findings and add regression tests for the change.',
          review: true,
        },
      ],
      producer,
      reviewer,
    );
  if (template === 'parallel')
    return [
      {
        ...step(
          'build',
          'implement',
          'Implement the change described in the brief. Leave documentation to the other step.',
        ),
        workspace: 'own',
      },
      {
        ...step(
          'docs',
          'implement',
          'Update the documentation for the change described in the brief. Do not change application code.',
        ),
        workspace: 'own',
      },
      review(['build', 'docs']),
    ];
  const build = step(
    'build',
    'implement',
    'Implement the change described in the brief and meet the success criteria.',
    template === 'plan' ? ['plan'] : [],
  );
  return template === 'plan'
    ? [
        step('plan', 'plan', 'Inspect the project and write an implementation plan for the brief.'),
        build,
        review(['build']),
      ]
    : [build, review(['build'])];
}

export interface WorkflowQueuedPrompt {
  prompt: string;
  review: boolean;
  model?: string;
  effort?: string;
}
export type WorkflowConversationMode = 'separate' | 'same';
export type WorkflowExecutionMode = 'sequence' | 'prompts' | 'parallel';

/** Change prompt scheduling without discarding instructions, models or review policies. */
export function setWorkflowExecution(
  steps: CreateWorkflowStep[],
  mode: WorkflowExecutionMode,
): CreateWorkflowStep[] {
  const ordered = workflowTasksInExecutionOrder(steps);
  const producers = ordered.filter((step) => workflowRoleProduces(step.role));
  const reviews = ordered.filter((step) => !workflowRoleProduces(step.role));
  const finalReview = reviews.filter((step) => step.role === 'review').at(-1);
  return ordered.map((step, index) => {
    if (mode === 'sequence')
      return {
        ...step,
        depends_on: index ? [ordered[index - 1]!.id] : [],
        workspace: 'shared',
        continue_from: step.continue_from,
      };
    if (workflowRoleProduces(step.role)) {
      const previous = producers[producers.indexOf(step) - 1];
      return {
        ...step,
        depends_on: mode === 'prompts' && previous ? [previous.id] : [],
        workspace: mode === 'parallel' ? 'own' : 'shared',
        continue_from: mode === 'prompts' ? step.continue_from : undefined,
      };
    }
    // The final review sees the combined result and waits for earlier reviews as well.
    if (step.id === finalReview?.id)
      return {
        ...step,
        depends_on: [
          ...producers,
          ...reviews.filter((review) => ordered.indexOf(review) < index),
        ].map((dependency) => dependency.id),
      };
    return step;
  });
}

export function workflowExecutionMode(
  steps: CreateWorkflowStep[],
): WorkflowExecutionMode | 'custom' {
  if (workflowIsQueue(steps)) return 'sequence';
  const producers = steps.filter((step) => workflowRoleProduces(step.role));
  if (producers.length > 1 && producers.every((step) => !step.depends_on.length)) return 'parallel';
  if (
    producers.length > 1 &&
    producers.every((step, index) =>
      index === 0
        ? !step.depends_on.length
        : step.depends_on.length === 1 && step.depends_on[0] === producers[index - 1]!.id,
    )
  )
    return 'prompts';
  return 'custom';
}

const reviewPrompt = (prompt: string) =>
  `Review the result of the preceding prompt. Report concrete issues with severity and file references; do not edit files.\n\nPrompt to review:\n${prompt || 'Use the shared brief and success criteria.'}`;

/** A queue is a dependency chain, including its reviews, rather than just a presentation order. */
export function createWorkflowPromptQueue(
  prompts: WorkflowQueuedPrompt[],
  producer: string,
  reviewer: string,
  conversation: WorkflowConversationMode = 'separate',
  reviewSettings: Partial<Pick<CreateWorkflowStep, 'model' | 'effort' | 'review_policy'>> = {},
  execution: WorkflowExecutionMode = 'sequence',
): CreateWorkflowStep[] {
  const steps: CreateWorkflowStep[] = [];
  prompts.forEach((entry, index) => {
    const id = `prompt-${index + 1}`;
    steps.push({
      ...newWorkflowStep(
        'implement',
        producer,
        id,
        steps.slice(-1).map((step) => step.id),
      ),
      prompt: entry.prompt.trim(),
      model: entry.model ?? '',
      effort: entry.effort ?? '',
      ...(conversation === 'same' && index > 0 ? { continue_from: `prompt-${index}` } : {}),
    });
    // Applying a workflow still requires an independent review of all finished work.
    if (entry.review || index === prompts.length - 1)
      steps.push({
        ...newWorkflowStep('review', reviewer, `review-${index + 1}`, [id]),
        prompt: reviewPrompt(entry.prompt.trim()),
        model: reviewSettings.model ?? '',
        effort: reviewSettings.effort ?? '',
        review_policy: reviewSettings.review_policy ?? 'on_findings',
      });
  });
  return execution === 'sequence' ? steps : setWorkflowExecution(steps, execution);
}

export const workflowStepDeclaration = (step: WorkflowStep): CreateWorkflowStep => ({
  id: step.id,
  role: step.role,
  target: step.target,
  model: step.model,
  effort: step.effort,
  mode: step.mode,
  prompt: step.prompt,
  depends_on: [...step.depends_on],
  workspace: step.workspace,
  continue_from: step.continue_from,
  review_policy: step.review_policy ?? '',
});

export const workflowStepLocked = (step: WorkflowStep) =>
  step.started_at != null || step.status !== 'pending';

export function workflowIsQueue(steps: CreateWorkflowStep[]) {
  return steps.every((step, index) =>
    index === 0
      ? step.depends_on.length === 0
      : step.depends_on.length === 1 && step.depends_on[0] === steps[index - 1]!.id,
  );
}

/** Reorder a sequential queue's actual execution order, retaining conversation chains. */
export function moveWorkflowQueue(
  steps: CreateWorkflowStep[],
  id: string,
  delta: number,
  locked: Set<string> = new Set(),
) {
  const from = steps.findIndex((step) => step.id === id),
    to = from + delta;
  if (
    !workflowIsQueue(steps) ||
    from < 0 ||
    to < 0 ||
    to >= steps.length ||
    locked.has(id) ||
    locked.has(steps[to]!.id)
  )
    return steps;
  const next = [...steps];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  let producer: CreateWorkflowStep | undefined;
  return next.map((step, index) => {
    const changed = locked.has(step.id)
      ? step
      : {
          ...step,
          depends_on: index ? [next[index - 1]!.id] : [],
          ...(step.continue_from
            ? { continue_from: producer?.target === step.target ? producer.id : undefined }
            : {}),
        };
    if (workflowRoleProduces(step.role)) producer = step;
    return changed;
  });
}

/** Insert between a selected step and all its successors, including fan-out connections. */
export function insertWorkflowTask(
  steps: CreateWorkflowStep[],
  afterId: string,
  role: 'implement' | 'review',
  target: string,
  reviewer: string,
  conversation: WorkflowConversationMode = 'separate',
) {
  const source = steps.find((step) => step.id === afterId);
  if (!source) return null;
  const id = workflowTaskId(
    role === 'review' ? `review-${afterId}` : 'prompt',
    new Set(steps.map((step) => step.id)),
  );
  const ancestors = workflowAncestors(steps, afterId);
  const producers = steps.filter(
    (step) => workflowRoleProduces(step.role) && (step.id === afterId || ancestors.has(step.id)),
  );
  const nearest = producers.filter(
    (step) =>
      !producers.some(
        (other) => other.id !== step.id && workflowAncestors(steps, other.id).has(step.id),
      ),
  );
  const previous = nearest.length === 1 ? nearest[0] : undefined;
  const continuing =
    role === 'implement' && conversation === 'same' && previous?.workspace !== 'own'
      ? previous
      : undefined;
  const descendants = workflowDescendants(steps, afterId);
  const added = {
    ...newWorkflowStep(role, continuing?.target ?? target, id, [afterId]),
    prompt: role === 'review' ? reviewPrompt(source.prompt) : '',
    ...(continuing ? { continue_from: continuing.id } : {}),
  };
  const hasSuccessors = steps.some((step) => step.depends_on.includes(afterId));
  const next = steps.flatMap((step) =>
    step.id === afterId
      ? [step, added]
      : [
          {
            ...step,
            depends_on: step.depends_on.map((dependency) =>
              dependency === afterId ? id : dependency,
            ),
            ...(continuing && step.continue_from === continuing.id && descendants.has(step.id)
              ? { continue_from: id }
              : {}),
          },
        ],
  );
  // Extending a completed chain keeps the old review in place and adds a final review for the new work.
  if (!hasSuccessors && role === 'implement') {
    const reviewId = workflowTaskId(`review-${id}`, new Set(next.map((step) => step.id)));
    next.push({ ...newWorkflowStep('review', reviewer, reviewId, [id]), prompt: reviewPrompt('') });
  }
  return { steps: next, id };
}

/** Reconnect the surrounding steps when a middle step is removed. */
export function removeWorkflowTask(steps: CreateWorkflowStep[], id: string) {
  const removed = steps.find((step) => step.id === id);
  return steps
    .filter((step) => step.id !== id)
    .map((step) => ({
      ...step,
      ...(step.continue_from === id ? { continue_from: removed?.continue_from ?? undefined } : {}),
      depends_on: [
        ...new Set(
          step.depends_on.flatMap((dependency) =>
            dependency === id ? (removed?.depends_on ?? []) : [dependency],
          ),
        ),
      ],
    }));
}

export function canConnectWorkflowTasks(
  steps: Pick<CreateWorkflowStep, 'id' | 'depends_on'>[],
  source: string,
  target: string,
) {
  return (
    steps.some((step) => step.id === source) &&
    steps.some((step) => step.id === target && !step.depends_on.includes(source)) &&
    !workflowWouldCycle(steps, target, source)
  );
}

export const workflowStepTitle = (step: { role: string; prompt: string }) =>
  step.prompt.trim().split('\n')[0] ||
  ({
    plan: i18n.t('Plan the work'),
    implement: i18n.t('Build the change'),
    review: i18n.t('Review the result'),
    revise: i18n.t('Address feedback'),
    validate: i18n.t('Validate the result'),
  }[step.role] ??
    'New step');

/** Stable columns follow execution order; siblings share a column. */
export function workflowCanvasPositions(steps: Pick<CreateWorkflowStep, 'id' | 'depends_on'>[]) {
  const levels = workflowTaskLevels(steps);
  const counts = new Map<number, number>();
  const totals = new Map<number, number>();
  for (const step of steps) {
    const level = levels[step.id] ?? 0;
    totals.set(level, (totals.get(level) ?? 0) + 1);
  }
  return Object.fromEntries(
    steps.map((step) => {
      const level = levels[step.id] ?? 0;
      const row = counts.get(level) ?? 0;
      counts.set(level, row + 1);
      return [step.id, { x: level * 310, y: (row - ((totals.get(level) ?? 1) - 1) / 2) * 180 }];
    }),
  );
}
