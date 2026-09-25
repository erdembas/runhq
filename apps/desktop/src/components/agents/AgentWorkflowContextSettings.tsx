import * as i18n from '@runhq/cockpit-ui/i18n';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { WorkflowContext } from '@/lib/ipc/agentWorkflowIpc';
import { pipelineMessage } from './pipelineMessages';

export function AgentWorkflowContextSettings({
  value,
  onChange,
  disabled,
}: {
  value: WorkflowContext;
  onChange?: (value: WorkflowContext) => void;
  disabled?: boolean;
}) {
  i18n.useLocale();
  const input = 'border-border bg-bg text-fg w-full rounded-lg border px-3 py-2 text-xs';
  return (
    <fieldset
      disabled={disabled || !onChange}
      className="border-border space-y-3 rounded-xl border p-4"
    >
      <legend className="text-fg px-1 text-xs font-medium">{i18n.t('Imported workspace')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-fg-muted space-y-1 text-xs">
          <span>{i18n.t('Workspace mode')}</span>
          <SearchableSelect
            label={i18n.t('Workspace mode')}
            value={value.workspace_mode}
            disabled={disabled || !onChange}
            searchable={false}
            options={[
              { value: 'direct', label: i18n.t('Direct repositories') },
              ...(value.repositories.length === 1
                ? [{ value: 'isolated', label: i18n.t('Isolated working copy') }]
                : []),
            ]}
            onChange={(mode) =>
              onChange?.({ ...value, workspace_mode: mode as WorkflowContext['workspace_mode'] })
            }
          />
        </label>
        <label className="text-fg-muted space-y-1 text-xs">
          <span>{i18n.t('Working folder')}</span>
          <input
            className={input}
            value={value.working_directory}
            onChange={(event) => onChange?.({ ...value, working_directory: event.target.value })}
          />
        </label>
      </div>
      {value.workspace_mode === 'direct' && (
        <p className="text-fg-muted text-xs">
          {i18n.t(
            'This workflow writes to the listed repositories. Review their paths and branches before starting.',
          )}
        </p>
      )}
      {value.repositories.map((repository, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr]">
          {(['name', 'path', 'branch'] as const).map((field) => (
            <label key={field} className="text-fg-muted space-y-1 text-xs">
              <span>
                {field === 'name'
                  ? i18n.t('Name')
                  : field === 'path'
                    ? i18n.t('Path')
                    : i18n.t('Branch')}
              </span>
              <input
                className={input}
                value={repository[field]}
                onChange={(event) =>
                  onChange?.({
                    ...value,
                    repositories: value.repositories.map((entry, at) =>
                      at === index ? { ...entry, [field]: event.target.value } : entry,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
      ))}
      {value.package_root && (
        <p className="text-fg-dim text-[11px] break-all">
          {i18n.t('Package assets')}: {value.package_root}
        </p>
      )}
      {!!value.issues?.length && (
        <ul className="text-fg-muted space-y-1 text-xs">
          {value.issues.map((issue, index) => (
            <li key={index}>
              {pipelineMessage(issue.code)}
              {issue.detail && (
                <pre className="mt-1 text-[11px] break-all whitespace-pre-wrap">{issue.detail}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
