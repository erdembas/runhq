import * as i18n from '@runhq/cockpit-ui/i18n';
import { AgentModelControls } from '@runhq/cockpit-ui';
import type { CreateWorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import { useAgentCatalog } from './useAgentCatalog';
import { isPoolTarget } from './agentAccountRouting';

export type WorkflowModelSettings = Pick<CreateWorkflowStep, 'model' | 'effort'> & {
  agent?: string;
};

/** Use the composer's provider catalog and pickers for both prompts and independent reviews. */
export function AgentWorkflowModelControls({
  projectId,
  target,
  workingDirectory,
  model,
  effort,
  agent = '',
  allowProfile = false,
  onChange,
  disabled,
  label = i18n.t('Model and reasoning'),
}: WorkflowModelSettings & {
  projectId: string;
  target: string;
  workingDirectory?: string;
  allowProfile?: boolean;
  onChange: (settings: WorkflowModelSettings) => void;
  disabled?: boolean;
  label?: string;
}) {
  i18n.useLocale();
  const pool = isPoolTarget(target);
  const { catalog, loading, refresh, error } = useAgentCatalog(
    target,
    '',
    projectId,
    !disabled && !pool,
    undefined,
    model,
    workingDirectory,
  );
  const unavailable = pool
    ? i18n.t(
        'Choose a specific agent to browse models. A pool uses the account selected at run time.',
      )
    : !projectId && !workingDirectory
      ? i18n.t('Choose a project to load the agent’s models.')
      : !target
        ? i18n.t('Choose an agent to load its models.')
        : null;
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <div className="text-fg-muted flex min-w-0 flex-wrap items-center gap-1 rounded-lg text-xs">
        <AgentModelControls
          catalog={unavailable ? null : catalog}
          loading={loading}
          refresh={refresh}
          model={model}
          effort={effort}
          agent={agent}
          onAgent={allowProfile ? (value) => onChange({ model, effort, agent: value }) : undefined}
          disabled={disabled || !!unavailable}
          onModel={(value) =>
            onChange({ model: value, effort: '', ...(allowProfile ? { agent } : {}) })
          }
          onEffort={(value) =>
            onChange({ model, effort: value, ...(allowProfile ? { agent } : {}) })
          }
        />
        {!catalog && (model || effort || agent) && (
          <button
            type="button"
            disabled={disabled}
            className="text-accent px-2 text-[11px] disabled:opacity-40"
            onClick={() =>
              onChange({ model: '', effort: '', ...(allowProfile ? { agent: '' } : {}) })
            }
          >
            {i18n.t('Use defaults')}
          </button>
        )}
      </div>
      {(unavailable || error) && (
        <p role={error ? 'status' : undefined} className="text-fg-dim text-[11px]">
          {unavailable || error}
        </p>
      )}
    </div>
  );
}
