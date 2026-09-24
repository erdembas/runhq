import * as i18n from '@runhq/cockpit-ui/i18n';
import { SearchableSelect } from '@runhq/cockpit-ui';
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
      <SearchableSelect
        label={i18n.t('After the review')}
        searchable={false}
        className="w-full"
        value={value || 'continue'}
        disabled={disabled}
        onChange={(next) => onChange(next as WorkflowReviewPolicy)}
        options={[
          { value: 'on_findings', label: i18n.t('Pause if issues are found') },
          { value: 'approval', label: i18n.t('Always wait for my approval') },
          { value: 'auto_fix', label: i18n.t('Fix issues, then review again') },
          { value: 'continue', label: i18n.t('Continue and pass findings to the next prompt') },
        ]}
      />
      <span className="text-fg-dim text-[11px]">
        {value === 'continue' || !value
          ? i18n.t('The next step starts even if the reviewer finds issues.')
          : value === 'auto_fix'
            ? i18n.t(
                'Correction attempts are limited by the step settings. Remaining issues wait for you.',
              )
            : i18n.t(
                'An unclear verdict waits for your decision. Applying changes always needs your approval.',
              )}
      </span>
    </label>
  );
}
