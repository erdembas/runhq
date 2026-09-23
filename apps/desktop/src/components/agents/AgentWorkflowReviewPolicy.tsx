import * as i18n from '@runhq/cockpit-ui/i18n';
import type { WorkflowReviewPolicy } from '@/lib/ipc/agentWorkflowIpc';

export function AgentWorkflowReviewPolicy({
  value,
  onChange,
  disabled,
}: {
  value?: WorkflowReviewPolicy | '';
  onChange: (value: WorkflowReviewPolicy) => void;
  disabled?: boolean;
}) {
  i18n.useLocale();
  return (
    <label className="text-fg-muted flex flex-col gap-1.5 text-xs">
      {i18n.t('After the review')}
      <select
        className="border-border bg-surface text-fg rounded-lg border p-2"
        value={value || 'continue'}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as WorkflowReviewPolicy)}
      >
        <option value="on_findings">{i18n.t('Pause if issues are found')}</option>
        <option value="approval">{i18n.t('Always wait for my approval')}</option>
        <option value="auto_fix">{i18n.t('Fix issues once, then review again')}</option>
        <option value="continue">{i18n.t('Continue and pass findings to the next prompt')}</option>
      </select>
      <span className="text-fg-dim text-[11px]">
        {value === 'continue' || !value
          ? i18n.t('The next step starts even if the reviewer finds issues.')
          : value === 'auto_fix'
            ? i18n.t('One correction attempt. Remaining issues or an unclear verdict wait for you.')
            : i18n.t(
                'An unclear verdict waits for your decision. Applying changes always needs your approval.',
              )}
      </span>
    </label>
  );
}
