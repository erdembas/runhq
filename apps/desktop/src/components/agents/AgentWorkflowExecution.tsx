import * as i18n from '@runhq/cockpit-ui/i18n';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { WorkflowExecutionMode } from './agentWorkflowEditor';

export function AgentWorkflowExecution({
  value,
  onChange,
  disabled,
  controlFlow = false,
}: {
  value: WorkflowExecutionMode | 'custom';
  onChange: (value: WorkflowExecutionMode) => void;
  disabled?: boolean;
  controlFlow?: boolean;
}) {
  i18n.useLocale();
  const descriptions = {
    sequence: i18n.t('Prompts follow the complete sequence, including reviews.'),
    prompts: i18n.t(
      'Each prompt waits for the previous prompt. Reviews run alongside the next prompt on a captured copy.',
    ),
    parallel: i18n.t(
      'Prompts start together in separate working copies, within agent capacity. A final review checks the combined result.',
    ),
    custom: i18n.t('Choose exactly which steps must finish before this step starts.'),
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-60 shrink-0">
        <p className="text-fg-dim mb-1.5 text-[11px]">{i18n.t('Prompt execution')}</p>
        <SearchableSelect
          label={i18n.t('Prompt execution')}
          searchable={false}
          value={value}
          disabled={disabled}
          options={[
            { value: 'sequence', label: i18n.t('Wait for reviews') },
            { value: 'prompts', label: i18n.t('After each prompt') },
            { value: 'parallel', label: i18n.t('All prompts in parallel') },
            ...(value === 'custom'
              ? [{ value: 'custom', label: i18n.t('Custom dependencies') }]
              : []),
          ]}
          onChange={(next) => {
            if (next !== 'custom') onChange(next as WorkflowExecutionMode);
          }}
        />
      </div>
      <p className="text-fg-muted min-w-48 flex-1 text-[11px] leading-relaxed">
        {controlFlow
          ? i18n.t('Imported conditions and gates keep their declared dependencies.')
          : descriptions[value]}
      </p>
    </div>
  );
}
