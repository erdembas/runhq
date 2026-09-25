import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState, type ComponentProps } from 'react';
import type { AgentWorkflow, CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import { AgentWorkflowTasks } from './AgentWorkflowTasks';
import { workflowStepDeclaration, workflowStepLocked } from './agentWorkflowEditor';
import { workflowStepsProblem } from './agentWorkflowStepPolicy';
import { workflowTasksInExecutionOrder } from './agentWorkflowGraph';

export function AgentWorkflowLiveEditor({
  workflow,
  onSave,
  onCancel,
  ...settings
}: {
  workflow: AgentWorkflow;
  onSave: (revision: number, steps: CreateWorkflowStep[]) => void;
  onCancel: () => void;
} & Pick<
  ComponentProps<typeof AgentWorkflowTasks>,
  'producers' | 'reviewers' | 'poolOptions' | 'resolveTarget' | 'disabled'
>) {
  i18n.useLocale();
  const [invalidSettings, setInvalidSettings] = useState(false);
  const [steps, setSteps] = useState(() => workflow.steps.map(workflowStepDeclaration));
  const problem = workflowStepsProblem(steps, workflow.context);
  return (
    <section
      className="border-accent/30 bg-surface space-y-3 rounded-xl border p-4"
      aria-label={i18n.t('Edit waiting steps')}
    >
      <h3 className="text-fg text-sm font-semibold">{i18n.t('Edit waiting steps')}</h3>
      <p className="text-fg-muted text-xs">
        {i18n.t(
          'Running work continues. New steps are paused until you save or discard this edit. Started steps stay unchanged.',
        )}
      </p>
      <AgentWorkflowTasks
        {...settings}
        context={workflow.context}
        projectId={workflow.project_id}
        live
        steps={steps}
        onChange={setSteps}
        onValidationChange={setInvalidSettings}
        lockedIds={workflow.steps.filter(workflowStepLocked).map((step) => step.id)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={settings.disabled || !!problem || invalidSettings}
          className="bg-accent text-accent-fg rounded-lg px-3 py-2 text-xs disabled:opacity-40"
          onClick={() => onSave(workflow.edit_revision ?? 0, workflowTasksInExecutionOrder(steps))}
        >
          {i18n.t('Save queue & resume')}
        </button>
        <button
          type="button"
          disabled={settings.disabled}
          className="border-border rounded-lg border px-3 py-2 text-xs disabled:opacity-40"
          onClick={onCancel}
        >
          {i18n.t('Discard edits & resume')}
        </button>
      </div>
    </section>
  );
}
