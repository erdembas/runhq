import { workflowAncestors } from './agentWorkflowGraph';
import * as i18n from '@runhq/cockpit-ui/i18n';
import type { CreateWorkflowStep, WorkflowExecution } from '@/lib/ipc/agentWorkflowIpc';

export function AgentWorkflowExecutionSettings({
  step,
  steps = [],
  direct = false,
  environmentDraft,
  onEnvironmentDraftChange,
  disabled,
  onChange,
}: {
  step: CreateWorkflowStep;
  steps?: CreateWorkflowStep[];
  direct?: boolean;
  environmentDraft?: string;
  onEnvironmentDraftChange?: (text: string, invalid: boolean) => void;
  disabled?: boolean;
  onChange: (execution: WorkflowExecution) => void;
}) {
  i18n.useLocale();
  const value = step.execution ?? {};
  const environmentText =
    environmentDraft ??
    Object.entries(value.environment ?? {})
      .map(([key, entry]) => `${key}=${entry}`)
      .join('\n');
  const environmentError = environmentText
    .split('\n')
    .some((line) => line.trim() && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line));
  const set = (patch: Partial<WorkflowExecution>) => onChange({ ...value, ...patch });
  const input = 'border-border bg-bg text-fg w-full rounded border px-2 py-1.5 text-xs';
  const numeric = (
    key:
      | 'timeout_minutes'
      | 'idle_timeout_minutes'
      | 'max_retries'
      | 'retry_delay_seconds'
      | 'max_fix_attempts'
      | 'max_runs',
    label: string,
    max: number,
    fallback = 0,
  ) => (
    <label className="text-fg-muted flex flex-col gap-1 text-xs" key={key}>
      {label}
      <input
        className={input}
        type="number"
        min={key === 'max_runs' ? 1 : 0}
        max={max}
        value={value[key] ?? fallback}
        onChange={(e) =>
          set({
            [key]: Math.max(key === 'max_runs' ? 1 : 0, Math.min(max, Number(e.target.value))),
          })
        }
      />
    </label>
  );
  return (
    <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
      <legend className="text-fg mb-2 text-xs font-medium">{i18n.t('Execution settings')}</legend>
      <div className="grid grid-cols-1 gap-2">
        {(
          [
            ['run_condition', i18n.t('Run condition')],
            ['complete_condition', i18n.t('Completion condition')],
            ['halt_condition', i18n.t('Stop condition')],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-fg-muted flex flex-col gap-1 text-xs">
            {label}
            <input
              className={input}
              value={value[key] ?? ''}
              onChange={(e) => set({ [key]: e.target.value })}
            />
          </label>
        ))}
        <p className="text-fg-dim text-[11px]">
          {i18n.t('Condition expressions use step IDs, verdicts and run counts.')}
        </p>
        {numeric('max_runs', i18n.t('Maximum runs'), 100, 1)}
        <label className="text-fg-muted flex flex-col gap-1 text-xs">
          {i18n.t('Repeat step after success')}
          <select
            className={input}
            value={value.rerun_step ?? ''}
            onChange={(e) => set({ rerun_step: e.target.value })}
          >
            <option value="">{i18n.t('None')}</option>
            {steps
              .filter((entry) => workflowAncestors(steps, step.id).has(entry.id))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
          </select>
        </label>
        <label className="text-fg-muted flex flex-col gap-1 text-xs">
          {i18n.t('Dependencies requiring PASS')}
          <select
            multiple
            className={input}
            value={value.require_pass ?? []}
            onChange={(e) =>
              set({ require_pass: Array.from(e.target.selectedOptions, (option) => option.value) })
            }
          >
            {steps
              .filter((entry) => workflowAncestors(steps, step.id).has(entry.id))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!['human', 'barrier'].includes(step.role) && (
        <>
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
            {!direct && (
              <span>
                {i18n.t('Relative to this step’s working copy. Leave empty to use its root.')}
              </span>
            )}
          </label>
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Resource lock')}
            <input
              className={input}
              value={value.lock ?? ''}
              onChange={(e) => set({ lock: e.target.value })}
            />
            <span>
              {i18n.t('Steps with the same lock run one at a time across all workflows.')}
            </span>
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
            {i18n.t('Result source')}
            <select
              className={input}
              value={value.result_scope ?? 'final_response'}
              onChange={(e) =>
                set({ result_scope: e.target.value as WorkflowExecution['result_scope'] })
              }
            >
              <option value="final_response">{i18n.t('Final response')}</option>
              <option value="combined_output">{i18n.t('Combined output')}</option>
            </select>
          </label>
          {(
            [
              ['success_scope', i18n.t('Success pattern (optional)')],
              ['failure_scope', i18n.t('Failure pattern (optional)')],
              ['verdict_scope', i18n.t('Verdict pattern')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-fg-muted flex flex-col gap-1 text-xs">
              {label} · {i18n.t('Match scope')}
              <select
                className={input}
                value={value[key] ?? 'last_line'}
                onChange={(e) => set({ [key]: e.target.value as 'output' | 'last_line' })}
              >
                <option value="last_line">{i18n.t('Last nonempty line')}</option>
                <option value="output">{i18n.t('Full output')}</option>
              </select>
            </label>
          ))}
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Verdict pattern')}
            <input
              className={input}
              value={value.verdict_regex ?? ''}
              onChange={(e) => set({ verdict_regex: e.target.value })}
            />
          </label>
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Result line pattern (optional)')}
            <input
              className={input}
              value={value.result_line_regex ?? ''}
              onChange={(e) => set({ result_line_regex: e.target.value })}
            />
            <span>{i18n.t('The final nonempty response line must match this pattern.')}</span>
          </label>
          {step.role === 'shell' &&
            (
              [
                ['success_exit_code', i18n.t('Success exit code')],
                ['failure_exit_code', i18n.t('Failure exit code')],
                ['failure_exit_code_not', i18n.t('Fail unless exit code')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-fg-muted flex flex-col gap-1 text-xs">
                {label}
                <input
                  className={input}
                  type="number"
                  value={value[key] ?? ''}
                  onChange={(e) =>
                    set({ [key]: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </label>
            ))}
          <label className="text-fg-muted flex flex-col gap-1 text-xs">
            {i18n.t('Environment variables')}
            <textarea
              className={input}
              rows={4}
              value={environmentText}
              onChange={(event) => {
                const text = event.target.value;
                const entries = text
                  .split('\n')
                  .filter((line) => line.trim())
                  .map((line) => {
                    const at = line.indexOf('=');
                    return [line.slice(0, at), line.slice(at + 1)];
                  });
                const invalid = text
                  .split('\n')
                  .some((line) => line.trim() && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line));
                onEnvironmentDraftChange?.(text, invalid);
                if (!invalid) set({ environment: Object.fromEntries(entries) });
              }}
            />
            <span>{i18n.t('One NAME=value entry per line.')}</span>
            {environmentError && (
              <span role="alert">{i18n.t('Invalid workflow execution settings.')}</span>
            )}
          </label>
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
                'Patterns use their selected match scope. Missing or ambiguous required results stop the workflow.',
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
              onChange={(e) =>
                set({ on_failure: e.target.value as WorkflowExecution['on_failure'] })
              }
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
        </>
      )}
    </fieldset>
  );
}
