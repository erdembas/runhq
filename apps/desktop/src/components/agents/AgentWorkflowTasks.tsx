import { useState } from 'react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentBackend } from '@runhq/cockpit-types';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import { workflowWouldCycle } from './agentWorkflowGraph';
import {
  MAX_WORKFLOW_STEPS,
  WORKFLOW_ROLE_OPTIONS,
  isolateConcurrentProducers,
  newWorkflowStep,
  replaceWorkflowTaskSummary,
  workflowRoleProduces,
  workflowTaskId,
  workflowTasksProblems,
} from './agentWorkflowStepPolicy';

// No width of its own: a row decides how much space each field gets, and `w-full` here would
// quietly win over the width the row asked for.
const field =
  'border-fg/10 bg-fg/3 text-fg focus:border-fg/25 rounded-xl border px-2 py-1.5 text-[12px]';

/**
 * Write the tasks a workflow runs.
 *
 * A workflow is dozens of separate instructions, each on an account of its own, ordered only by what
 * they say they wait for. One row per task keeps that readable: the instruction, who runs it and
 * what it follows on one line, everything else behind the row's own disclosure. Order in this list
 * is presentation; execution order comes from the dependencies.
 */
export function AgentWorkflowTasks({
  steps,
  onChange,
  producers,
  reviewers,
  poolOptions,
  resolveTarget,
  disabled,
}: {
  steps: CreateWorkflowStep[];
  onChange: (steps: CreateWorkflowStep[]) => void;
  producers: AgentBackend[];
  reviewers: AgentBackend[];
  poolOptions: { value: string; label: string; description?: string }[];
  resolveTarget: (target: string, candidates: AgentBackend[]) => string;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const problems = workflowTasksProblems(steps);
  const blocking = problems.filter((problem) => problem.severity === 'error');
  const candidates = (role: string) => (workflowRoleProduces(role) ? producers : reviewers);
  const update = (id: string, patch: Partial<CreateWorkflowStep>) =>
    onChange(steps.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  const taken = () => new Set(steps.map((step) => step.id));
  const addTask = (after?: number) => {
    if (steps.length >= MAX_WORKFLOW_STEPS) return;
    const id = workflowTaskId('', taken());
    const created = newWorkflowStep('implement', producers[0]?.id ?? '', id);
    const next = [...steps];
    next.splice(after === undefined ? steps.length : after + 1, 0, created);
    onChange(next);
    setExpanded(id);
  };
  /** Removing a task also removes it from everything that waited for it. */
  const removeTask = (id: string) =>
    onChange(
      steps
        .filter((step) => step.id !== id)
        .map((step) => ({ ...step, depends_on: step.depends_on.filter((dep) => dep !== id) })),
    );
  const toggleDependency = (id: string, dependency: string) => {
    const step = steps.find((entry) => entry.id === id);
    if (!step) return;
    update(id, {
      depends_on: step.depends_on.includes(dependency)
        ? step.depends_on.filter((entry) => entry !== dependency)
        : [...step.depends_on, dependency],
    });
  };
  const problemFor = (id: string) => blocking.find((problem) => problem.taskId === id);

  return (
    <fieldset disabled={disabled} className="border-border space-y-2 rounded-xl border p-3">
      <legend className="text-fg-muted px-1 text-[11px]">
        Tasks &middot; {steps.length} &middot; each runs on its own account, in the order its
        dependencies require
      </legend>
      {steps.map((step, index) => {
        const open = expanded === step.id;
        const failure = problemFor(step.id);
        return (
          <div
            key={step.id || index}
            className={`space-y-1.5 rounded-lg border p-2 ${failure ? 'border-warning/50' : 'border-fg/8'}`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`${open ? 'Collapse' : 'Expand'} task ${step.id}`}
                aria-expanded={open}
                className="hover:bg-fg/5 rounded px-1 text-[11px]"
                onClick={() => setExpanded(open ? null : step.id)}
              >
                {open ? '▾' : '▸'}
              </button>
              <input
                className={`${field} w-24 shrink-0 font-mono`}
                aria-label={`Task ${index + 1} key`}
                value={step.id}
                onChange={(e) => {
                  const previous = step.id;
                  const id = e.target.value.trim();
                  // A key is how other tasks name this one, so renaming it renames it there too.
                  onChange(
                    steps.map((entry) =>
                      entry.id === previous
                        ? { ...entry, id }
                        : {
                            ...entry,
                            depends_on: entry.depends_on.map((dep) =>
                              dep === previous ? id : dep,
                            ),
                          },
                    ),
                  );
                  setExpanded((current) => (current === previous ? id : current));
                }}
              />
              {open ? null : (
                <input
                  className={`${field} min-w-0 flex-1`}
                  aria-label={`Task ${step.id} instruction`}
                  placeholder="What should this task do?"
                  value={step.prompt.split('\n')[0] ?? ''}
                  title={step.prompt}
                  onChange={(e) =>
                    update(step.id, {
                      prompt: replaceWorkflowTaskSummary(step.prompt, e.target.value),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      addTask(index);
                    }
                  }}
                />
              )}
              <SearchableSelect
                label={`Task ${step.id} account`}
                searchable={false}
                className="w-40 shrink-0"
                value={step.target}
                options={[
                  ...candidates(step.role).map((tool) => ({ value: tool.id, label: tool.name })),
                  ...poolOptions,
                ]}
                onChange={(target) =>
                  update(step.id, { target: resolveTarget(target, candidates(step.role)) })
                }
              />
              <button
                type="button"
                aria-label={`Remove task ${step.id}`}
                disabled={steps.length <= 1}
                className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-30"
                onClick={() => removeTask(step.id)}
              >
                &times;
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1 pl-7">
              <span className="text-fg-dim text-[10px]">after</span>
              {steps
                .filter((other) => other.id !== step.id)
                .map((other) => {
                  const chosen = step.depends_on.includes(other.id);
                  const loops = !chosen && workflowWouldCycle(steps, step.id, other.id);
                  return (
                    <button
                      key={other.id}
                      type="button"
                      disabled={loops}
                      title={
                        loops
                          ? `“${other.id}” already waits for “${step.id}”`
                          : `Run “${step.id}” after “${other.id}”`
                      }
                      aria-pressed={chosen}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] disabled:opacity-25 ${
                        chosen
                          ? 'border-accent/60 bg-accent/10 text-fg'
                          : 'border-fg/10 text-fg-dim'
                      }`}
                      onClick={() => toggleDependency(step.id, other.id)}
                    >
                      {other.id}
                    </button>
                  );
                })}
              {!step.depends_on.length && (
                <span className="text-fg-dim text-[10px]">nothing — starts straight away</span>
              )}
            </div>
            {open && (
              <div className="space-y-1.5 pl-7">
                <div className="flex flex-wrap items-center gap-2">
                  <SearchableSelect
                    label={`Task ${step.id} role`}
                    searchable={false}
                    className="w-32"
                    value={step.role}
                    options={WORKFLOW_ROLE_OPTIONS}
                    onChange={(role) => {
                      const next = role as CreateWorkflowStep['role'];
                      update(step.id, {
                        role: next,
                        target: candidates(next).some((tool) => tool.id === step.target)
                          ? step.target
                          : (candidates(next)[0]?.id ?? ''),
                        workspace: workflowRoleProduces(next) ? step.workspace : 'shared',
                      });
                    }}
                  />
                  <input
                    className={`${field} w-40`}
                    aria-label={`Task ${step.id} model`}
                    value={step.model}
                    placeholder="Provider default"
                    onChange={(e) => update(step.id, { model: e.target.value })}
                  />
                  <label className="text-fg-muted flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      disabled={!workflowRoleProduces(step.role)}
                      checked={step.workspace === 'own'}
                      onChange={(e) =>
                        update(step.id, { workspace: e.target.checked ? 'own' : 'shared' })
                      }
                    />
                    Own worktree
                  </label>
                </div>
                <textarea
                  className={`${field} min-h-24 w-full`}
                  aria-label={`Task ${step.id} instruction`}
                  placeholder="What should this task do?"
                  value={step.prompt}
                  onChange={(e) => update(step.id, { prompt: e.target.value })}
                />
              </div>
            )}
            {failure && <p className="text-warning pl-7 text-[11px]">{failure.message}</p>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={steps.length >= MAX_WORKFLOW_STEPS}
          className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
          onClick={() => addTask()}
        >
          Add task
        </button>
        {blocking
          .filter((problem) => !problem.taskId)
          .map((problem) => (
            <span key={problem.message} className="text-warning text-[11px]">
              {problem.message}
            </span>
          ))}
        {blocking.some((problem) => problem.fix === 'isolate-concurrent-producers') && (
          <button
            type="button"
            className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-1 text-[11px]"
            onClick={() => onChange(isolateConcurrentProducers(steps))}
          >
            Give each its own worktree
          </button>
        )}
      </div>
      {problems
        .filter((problem) => problem.severity === 'warning')
        .map((problem) => (
          <p key={problem.message} className="text-fg-dim text-[10px]">
            {problem.message}
          </p>
        ))}
      <p className="text-fg-dim text-[10px] leading-relaxed">
        Tasks that wait for nothing in common run at the same time, each on its own account; a pool
        picks a free one when the task starts. Two tasks that change code can only run together when
        each has its own worktree — one checkout never carries two agents. Review and validation run
        read-only.
      </p>
    </fieldset>
  );
}
