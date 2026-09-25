import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentBackend } from '@runhq/cockpit-types';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import { AgentWorkflowModelControls } from './AgentWorkflowModelControls';
import { workflowRoleReviews } from './agentWorkflowGraph';
import {
  applyWorkflowRoleModels,
  workflowModelSettings,
  type WorkflowRoleModelSettings,
} from './agentWorkflowModels';

type Props = {
  steps: CreateWorkflowStep[];
  lockedIds: string[];
  projectId: string;
  workingDirectory?: string;
  producers: AgentBackend[];
  reviewers: AgentBackend[];
  poolOptions: { value: string; label: string; description?: string }[];
  resolveTarget: (target: string, candidates: AgentBackend[]) => string;
  disabled?: boolean;
  onChange: (steps: CreateWorkflowStep[]) => void;
};

export function AgentWorkflowRoleModels(props: Props) {
  i18n.useLocale();
  const locked = new Set(props.lockedIds);
  const roles = [
    { role: 'implement', label: i18n.t('Implementation model') },
    { role: 'review', label: i18n.t('Review model') },
    { role: 'revise', label: i18n.t('Revision model') },
    { role: 'plan', label: i18n.t('Planning model') },
    { role: 'validate', label: i18n.t('Validation model') },
  ] as const;
  const groups = roles.flatMap(({ role, label }) => {
    const steps = props.steps.filter((step) => step.role === role && !locked.has(step.id));
    if (!steps.length) return [];
    const settings = steps.map(workflowModelSettings);
    return [{ role, label, count: steps.length, settings, signature: JSON.stringify(settings) }];
  });
  if (!groups.length) return null;
  return (
    <section
      aria-label={i18n.t('Models by step type')}
      className="border-border space-y-3 border-t p-3"
    >
      <div className="space-y-1">
        <h3 className="text-fg text-xs font-medium">{i18n.t('Models by step type')}</h3>
        <p className="text-fg-dim text-[11px]">
          {i18n.t(
            'Choose an agent, model and reasoning level, then apply them to all steps of that type.',
          )}
        </p>
        <p className="text-fg-dim text-[11px]">
          {i18n.t(
            'Started steps keep their settings. Changing agents starts a new conversation where needed.',
          )}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ role, label, count, settings, signature }) => (
          <RoleModelCard
            // Resync after imports, undo and individual model edits, preserving unsubmitted
            // choices across prompt edits and language changes.
            key={`${role}:${signature}`}
            label={label}
            count={count}
            initial={settings[0]!}
            mixed={settings.some((value) => JSON.stringify(value) !== JSON.stringify(settings[0]))}
            candidates={workflowRoleReviews(role) ? props.reviewers : props.producers}
            projectId={props.projectId}
            workingDirectory={props.workingDirectory}
            poolOptions={props.poolOptions}
            resolveTarget={props.resolveTarget}
            disabled={props.disabled}
            onApply={(settings) =>
              props.onChange(applyWorkflowRoleModels(props.steps, role, settings, locked))
            }
          />
        ))}
      </div>
    </section>
  );
}

function RoleModelCard({
  label,
  count,
  initial,
  mixed,
  candidates,
  projectId,
  workingDirectory,
  poolOptions,
  resolveTarget,
  disabled,
  onApply,
}: Pick<Props, 'projectId' | 'workingDirectory' | 'poolOptions' | 'resolveTarget' | 'disabled'> & {
  label: string;
  count: number;
  initial: WorkflowRoleModelSettings;
  mixed: boolean;
  candidates: AgentBackend[];
  onApply: (settings: WorkflowRoleModelSettings) => void;
}) {
  i18n.useLocale();
  const [settings, setSettings] = useState(initial);
  const changed = mixed || JSON.stringify(settings) !== JSON.stringify(initial);
  return (
    <fieldset
      disabled={disabled}
      className="border-border bg-surface min-w-0 space-y-2 rounded-lg border p-3"
    >
      <legend className="text-fg px-1 text-xs font-medium">{label}</legend>
      {mixed && (
        <p className="text-fg-dim text-[11px]">
          {i18n.t('These steps currently use different settings.')}
        </p>
      )}
      <SearchableSelect
        label={i18n.t('Agent')}
        value={settings.target}
        disabled={disabled}
        searchable={false}
        options={[
          ...candidates.map((tool) => ({ value: tool.id, label: tool.name })),
          ...poolOptions,
        ]}
        onChange={(value) => {
          const target = resolveTarget(value, candidates);
          if (target !== settings.target) setSettings({ target, model: '', effort: '' });
        }}
      />
      <AgentWorkflowModelControls
        projectId={projectId}
        workingDirectory={workingDirectory}
        target={settings.target}
        model={settings.model}
        effort={settings.effort}
        disabled={disabled}
        onChange={({ model, effort }) => setSettings({ ...settings, model, effort })}
      />
      <button
        type="button"
        disabled={disabled || !settings.target || !changed}
        className="border-border hover:bg-fg/5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
        onClick={() => onApply(settings)}
      >
        {i18n.plural('Apply to {count} step', 'Apply to {count} steps', count)}
      </button>
    </fieldset>
  );
}
