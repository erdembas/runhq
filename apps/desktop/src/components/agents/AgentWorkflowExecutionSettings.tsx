import * as i18n from '@runhq/cockpit-ui/i18n';
import type { CreateWorkflowStep, WorkflowExecution } from '@/lib/ipc/agentWorkflowIpc';

export function AgentWorkflowExecutionSettings({
  step,
  disabled,
  onChange,
}: {
  step: CreateWorkflowStep;
  disabled?: boolean;
  onChange: (execution: WorkflowExecution) => void;
}) {
  i18n.useLocale();
  const value = step.execution ?? {};
  const set = (patch: Partial<WorkflowExecution>) => onChange({ ...value, ...patch });
  const input = 'border-border bg-bg text-fg w-full rounded border px-2 py-1.5 text-xs';
  const numeric = (
    key:
      | 'timeout_minutes'
      | 'idle_timeout_minutes'
      | 'max_retries'
      | 'retry_delay_seconds'
      | 'max_fix_attempts',
    label: string,
    max: number,
    fallback = 0,
  ) => (
    <label className="text-fg-muted flex flex-col gap-1 text-xs" key={key}>
      {label}
      <input
        className={input}
        type="number"
        min={0}
        max={max}
        value={value[key] ?? fallback}
        onChange={(e) => set({ [key]: Math.max(0, Math.min(max, Number(e.target.value))) })}
      />
    </label>
  );
  return (
    <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
      <legend className="text-fg mb-2 text-xs font-medium">{i18n.t('Execution settings')}</legend>
      {step.role === 'shell' && (
        <label className="text-fg-muted flex flex-col gap-1 text-xs">
          {i18n.t('Terminal command')}
          <textarea
            className={input}
            rows={3}
            value={value.command ?? ''}
            onChange={(e) => set({ command: e.target.value })}
          />
          <span>
            {i18n.t(
              'Exit code 0 succeeds. Other exit codes stop the workflow after any configured retries.',
            )}
          </span>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {numeric('timeout_minutes', i18n.t('Time limit (minutes)'), 10080)}
        {numeric('idle_timeout_minutes', i18n.t('No activity limit (minutes)'), 10080)}
        {numeric('max_retries', i18n.t('Automatic retries'), 10)}
        {numeric('retry_delay_seconds', i18n.t('Retry delay (seconds)'), 86400, 30)}
      </div>
      <p className="text-fg-dim text-[11px]">
        {i18n.t(
          'Zero disables a time limit. Retries repeat the step in its existing working copy; partial changes remain. Human input and paused agents do not count as inactivity.',
        )}
      </p>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('Working subfolder')}
        <input
          className={input}
          value={value.working_directory ?? ''}
          onChange={(e) => set({ working_directory: e.target.value })}
        />
        <span>{i18n.t('Relative to this step’s working copy. Leave empty to use its root.')}</span>
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('Resource lock')}
        <input
          className={input}
          value={value.lock ?? ''}
          onChange={(e) => set({ lock: e.target.value })}
        />
        <span>{i18n.t('Steps with the same lock run one at a time across all workflows.')}</span>
      </label>
      {step.review_policy === 'auto_fix' && (
        <>
          {numeric('max_fix_attempts', i18n.t('Maximum correction attempts'), 10, 1)}
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Correction prompt (optional)')}
            <textarea
              className={input}
              rows={4}
              value={value.fix_prompt ?? ''}
              onChange={(e) => set({ fix_prompt: e.target.value })}
            />
          </label>
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Checks after each correction')}
            <textarea
              className={input}
              rows={3}
              value={value.fix_commands?.join('\n') ?? ''}
              onChange={(e) => set({ fix_commands: e.target.value.split('\n') })}
              onBlur={() => set({ fix_commands: value.fix_commands?.filter((s) => s.trim()) })}
            />
            <span>
              {i18n.t(
                'One command per line. If empty, directly preceding terminal steps are repeated before the new review.',
              )}
            </span>
          </label>
        </>
      )}
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('Result format')}
        <select
          className={input}
          value={value.result_format ?? 'none'}
          onChange={(e) =>
            set({ result_format: e.target.value as WorkflowExecution['result_format'] })
          }
        >
          <option value="none">{i18n.t('Provider completion')}</option>
          <option value="json">{i18n.t('Structured step result')}</option>
          <option value="pipeline">{i18n.t('Pipeline result marker')}</option>
          <option value="review">{i18n.t('Review verdict marker')}</option>
        </select>
        <span>
          {i18n.t(
            'Result markers and patterns are checked against the final nonempty response line. Missing or ambiguous markers require your decision.',
          )}
        </span>
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('Success pattern (optional)')}
        <input
          className={input}
          value={value.success_regex ?? ''}
          onChange={(e) => set({ success_regex: e.target.value })}
        />
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('Failure pattern (optional)')}
        <input
          className={input}
          value={value.failure_regex ?? ''}
          onChange={(e) => set({ failure_regex: e.target.value })}
        />
      </label>
      <label className="text-fg-muted flex flex-col gap-1 text-xs">
        {i18n.t('After a failure')}
        <select
          className={input}
          value={value.on_failure ?? 'pause'}
          onChange={(e) => set({ on_failure: e.target.value as WorkflowExecution['on_failure'] })}
        >
          <option value="pause">{i18n.t('Stop starting new steps')}</option>
          <option value="cancel">{i18n.t('Also stop running steps')}</option>
        </select>
      </label>
      {['plan', 'implement', 'revise', 'shell'].includes(step.role) &&
        step.depends_on.length > 0 && (
          <>
            <label className="text-fg-muted flex flex-col gap-1 text-xs">
              {i18n.t('Run only after this result')}
              <select
                className={input}
                value={value.run_if?.step_id ?? ''}
                onChange={(e) =>
                  set({
                    run_if: e.target.value
                      ? {
                          step_id: e.target.value,
                          outcomes: value.run_if?.outcomes ?? ['findings'],
                        }
                      : null,
                  })
                }
              >
                <option value="">{i18n.t('Always run')}</option>
                {step.depends_on.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            {value.run_if && (
              <label className="text-fg-muted flex flex-col gap-1 text-xs">
                {i18n.t('Required outcome')}
                <select
                  className={input}
                  value={value.run_if.outcomes[0]}
                  onChange={(e) =>
                    set({
                      run_if: {
                        step_id: value.run_if!.step_id,
                        outcomes: [e.target.value as 'pass' | 'findings' | 'skipped'],
                      },
                    })
                  }
                >
                  <option value="pass">{i18n.t('Passed')}</option>
                  <option value="findings">{i18n.t('Findings')}</option>
                  <option value="skipped">{i18n.t('Skipped')}</option>
                </select>
              </label>
            )}
          </>
        )}
    </fieldset>
  );
}
