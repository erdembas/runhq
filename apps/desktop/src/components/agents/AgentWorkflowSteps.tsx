import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentBackend } from '@runhq/cockpit-types';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  MAX_WORKFLOW_STEPS,
  WORKFLOW_ROLE_OPTIONS,
  moveWorkflowStep,
  newWorkflowStep,
  workflowRoleProduces,
  workflowStepsProblem,
} from './agentWorkflowStepPolicy';

const field =
  'border-fg/10 bg-fg/3 text-fg focus:border-fg/25 w-full rounded-xl border px-3 py-2 text-[12px]';

/**
 * Edit the ordered roles a workflow runs.
 *
 * A reviewing role is offered only the connections that have a real read-only mode, so a division
 * of labour that cannot be reviewed is not expressible here. A pool is resolved as soon as it is
 * chosen, because the screen shows the identity that will run — see `resolveTarget`.
 */
export function AgentWorkflowSteps({
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
  const problem = workflowStepsProblem(steps);
  const candidates = (role: string) => (workflowRoleProduces(role) ? producers : reviewers);
  const update = (index: number, patch: Partial<CreateWorkflowStep>) =>
    onChange(steps.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  return (
    <fieldset disabled={disabled} className="border-border space-y-2 rounded-xl border p-3">
      <legend className="text-fg-muted px-1 text-[11px]">
        Steps &middot; each runs as its own account, in order
      </legend>
      {steps.map((step, index) => (
        // Two predictable lines rather than one row that wraps differently at every width: role
        // and account, then the model beside this step's own controls.
        <div key={index} className="border-fg/8 space-y-1.5 rounded-lg border p-2">
          <div className="flex items-center gap-2">
            <span className="text-fg-dim w-4 shrink-0 text-[11px]">{index + 1}</span>
            <SearchableSelect
              label={`Step ${index + 1} role`}
              searchable={false}
              className="w-32"
              value={step.role}
              options={WORKFLOW_ROLE_OPTIONS}
              onChange={(role) => {
                const next = role as CreateWorkflowStep['role'];
                // Moving between producing and reviewing can invalidate the account, so it is
                // re-resolved rather than left naming a connection this role cannot use.
                update(index, {
                  role: next,
                  target: candidates(next).some((tool) => tool.id === step.target)
                    ? step.target
                    : (candidates(next)[0]?.id ?? ''),
                });
              }}
            />
            <SearchableSelect
              label={`Step ${index + 1} account`}
              searchable={false}
              className="min-w-0 flex-1"
              value={step.target}
              options={[
                ...candidates(step.role).map((tool) => ({ value: tool.id, label: tool.name })),
                ...poolOptions,
              ]}
              onChange={(target) =>
                update(index, { target: resolveTarget(target, candidates(step.role)) })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              className={`${field} min-w-0 flex-1`}
              aria-label={`Step ${index + 1} model`}
              value={step.model}
              placeholder="Provider default"
              onChange={(e) => update(index, { model: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Move step ${index + 1} up`}
              disabled={index === 0}
              className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-30"
              onClick={() => onChange(moveWorkflowStep(steps, index, -1))}
            >
              &uarr;
            </button>
            <button
              type="button"
              aria-label={`Move step ${index + 1} down`}
              disabled={index === steps.length - 1}
              className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-30"
              onClick={() => onChange(moveWorkflowStep(steps, index, 1))}
            >
              &darr;
            </button>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              disabled={steps.length <= 1}
              className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-30"
              onClick={() => onChange(steps.filter((_, at) => at !== index))}
            >
              &times;
            </button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={steps.length >= MAX_WORKFLOW_STEPS}
          className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
          onClick={() => onChange([...steps, newWorkflowStep('review', reviewers[0]?.id ?? '')])}
        >
          Add step
        </button>
        {problem && <span className="text-warning text-[11px]">{problem}</span>}
      </div>
      <p className="text-fg-dim text-[10px] leading-relaxed">
        Each step takes the previous step&rsquo;s result as its input and runs on its own account; a
        pool picks a free one when the step starts. Review and validation run read-only.
      </p>
    </fieldset>
  );
}
