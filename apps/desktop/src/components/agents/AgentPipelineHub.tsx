import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, Upload, Play, Pause } from 'lucide-react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import { useAgentStore } from '@/store/useAgentStore';
import { useVisibleStore } from '@/lib/useVisibleStore';
import {
  agentPipelineIpc,
  type PipelineRun,
  type PipelineSummary,
} from '@/lib/ipc/agentPipelineIpc';
import { pipelineMessage, pipelineStatus } from './pipelineMessages';
const button =
  'border-border hover:bg-fg/5 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-40';
export function AgentPipelineHub({
  visible,
  onBack,
  onOpenSession,
}: {
  visible: boolean;
  onBack: () => void;
  onOpenSession?: (id: string) => void;
}) {
  i18n.useLocale();
  const tools = useVisibleStore(useAgentStore, (s) => s.tools, visible);
  const [rows, setRows] = useState<PipelineSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [stepId, setStepId] = useState('');
  const [backend, setBackend] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(run);
  current.current = run;
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const rows = await agentPipelineIpc.list();
        if (disposed) return;
        setRows(rows);
        if (!selected && rows[0]) setSelected(rows[0].id);
        const row = rows.find((r) => r.id === selected);
        if (row && (current.current?.id !== row.id || current.current.revision !== row.revision)) {
          const next = await agentPipelineIpc.get(row.id);
          if (!disposed)
            setRun((old) => (old?.id === next.id && old.revision > next.revision ? old : next));
        }
      } catch (e) {
        if (!disposed) setError(pipelineMessage(String(e)));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [visible, selected]);
  const available = tools.filter(
    (t) => t.available && t.enabled !== false && t.adapter !== 'terminal',
  );
  const reviewers = available.filter((t) => ['codex', 'claude'].includes(t.adapter ?? t.id));
  const chosenBackend = backend || available[0]?.id || '';
  const chosenReviewer = reviewer || reviewers[0]?.id || '';
  const step = run?.manifest.steps.find((s) => s.id === stepId) ?? run?.manifest.steps[0];
  const state = step && run?.steps[step.id];
  const extraReview =
    step?.type === 'barrier' &&
    step.dependsOn.length === 1 &&
    run?.manifest.steps.some((s) => s.id === step.dependsOn[0] && s.capture);
  const reviewNeedsPass =
    !!step?.capture &&
    state?.status === 'completed' &&
    state.verdict !== 'PASS' &&
    run?.state === 'halted';
  const act = async (action: string, id?: string) => {
    if (!run) return;
    setBusy(true);
    setError('');
    try {
      setRun(await agentPipelineIpc.control(run, action, id, chosenBackend, chosenReviewer));
    } catch (e) {
      setError(pipelineMessage(String(e)));
    } finally {
      setBusy(false);
    }
  };
  const importPackage = async () => {
    setBusy(true);
    setError('');
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: i18n.t('Pipeline packages'), extensions: ['json', 'zip'] }],
      });
      if (typeof path !== 'string') return;
      const next = await agentPipelineIpc.import(path);
      setSelected(next.id);
      setRun(next);
      setStepId('');
    } catch (e) {
      setError(pipelineMessage(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="bg-surface text-fg flex h-full min-h-0 flex-col"
      aria-label={i18n.t('Pipeline packages')}
    >
      <header className="border-border flex shrink-0 flex-wrap items-center gap-3 border-b p-4">
        <button type="button" className={button} onClick={onBack}>
          <ArrowLeft className="size-4" />
          {i18n.t('Back to workflows')}
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{i18n.t('Pipeline packages')}</h2>
          <p className="text-fg-muted mt-1 text-xs">
            {i18n.t('Open a JSON or ZIP package as a one-time workflow.')}
          </p>
        </div>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void importPackage()}
        >
          <Upload className="size-4" />
          {i18n.t('Import pipeline package')}
        </button>
      </header>
      {error && (
        <p role="alert" className="text-status-error px-4 py-2 text-xs">
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 md:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label={i18n.t('Pipeline packages')}
          className="border-border space-y-2 overflow-auto border-r p-3"
        >
          {!rows.length && !run && (
            <p className="text-fg-muted text-xs">{i18n.t('No pipeline packages yet.')}</p>
          )}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={selected === row.id}
              onClick={() => {
                setSelected(row.id);
                setRun(null);
                setStepId('');
              }}
              className={`w-full rounded-lg border p-3 text-left ${selected === row.id ? 'border-accent bg-accent/5' : 'border-border'}`}
            >
              <strong className="block truncate text-xs">{row.name}</strong>
              <span className="text-fg-muted mt-1 block text-[11px]">
                {pipelineStatus(row.state)}
              </span>
              <span className="text-fg-dim mt-1 block text-[11px]">
                {i18n.t('{completed} of {total} steps finished', {
                  completed: row.completed,
                  total: row.total,
                })}
              </span>
            </button>
          ))}
        </nav>
        {run && (
          <div className="min-w-0 overflow-auto p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{run.manifest.name}</h3>
                <p className="text-fg-muted text-xs">{pipelineStatus(run.state)}</p>
              </div>
              {run.state === 'running' && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void act('pause')}
                >
                  <Pause className="size-4" />
                  {i18n.t('Pause new steps')}
                </button>
              )}
              {['paused', 'halted'].includes(run.state) &&
                !Object.values(run.steps).some((s) => s.status === 'failed') && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => void act('resume')}
                  >
                    {i18n.t('Resume pipeline')}
                  </button>
                )}
            </div>
            <details
              open={run.state === 'draft'}
              className="border-border mb-4 rounded-xl border p-4"
            >
              <summary className="cursor-pointer text-sm font-medium">
                {i18n.t('Package check')}
              </summary>
              <p className="text-fg-muted my-3 text-xs">
                {i18n.t(
                  'This run writes directly to the repositories below. Review their paths and branches before starting.',
                )}
              </p>
              <ul className="space-y-2">
                {run.repositories.map((repo) => (
                  <li key={repo.path} className="text-xs">
                    <strong>{repo.name}</strong> <code>{repo.branch}</code>
                    <p className="text-fg-dim break-all">{repo.path}</p>
                  </li>
                ))}
              </ul>
              {!!run.issues.length && (
                <ul className="my-4 space-y-2">
                  {run.issues.map((issue, index) => (
                    <li
                      key={index}
                      className={`rounded-lg border p-3 text-xs ${issue.blocking ? 'border-status-error/30 text-status-error' : 'border-border text-fg-muted'}`}
                    >
                      <p>{pipelineMessage(issue.code)}</p>
                      {issue.detail && (
                        <p className="mt-1 font-mono text-[11px] break-all">{issue.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <dl className="text-fg-dim my-4 space-y-1 text-[11px]">
                <dt>{i18n.t('Package files')}</dt>
                <dd className="break-all">{run.package_root}</dd>
                <dt>{i18n.t('Execution records')}</dt>
                <dd className="break-all">{run.run_root}</dd>
              </dl>
              {run.state === 'draft' && (
                <>
                  <div className="mb-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-fg-muted space-y-1 text-xs">
                      <span>{i18n.t('Implementation agent')}</span>
                      <SearchableSelect
                        label={i18n.t('Implementation agent')}
                        value={chosenBackend}
                        onChange={setBackend}
                        options={available.map((t) => ({ value: t.id, label: t.name }))}
                      />
                    </label>
                    <label className="text-fg-muted space-y-1 text-xs">
                      <span>{i18n.t('Review agent')}</span>
                      <SearchableSelect
                        label={i18n.t('Review agent')}
                        value={chosenReviewer}
                        onChange={setReviewer}
                        options={reviewers.map((t) => ({ value: t.id, label: t.name }))}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className={`${button} bg-accent text-accent-fg`}
                    disabled={
                      busy ||
                      !chosenBackend ||
                      !chosenReviewer ||
                      run.issues.some((i) => i.blocking)
                    }
                    onClick={() => void act('start')}
                  >
                    <Play className="size-4" />
                    {i18n.t('Start in these folders')}
                  </button>
                  {run.issues.some((i) => i.blocking) && (
                    <p className="text-fg-muted mt-2 text-xs">
                      {i18n.t('Fix the blocking issues in the source package and import it again.')}
                    </p>
                  )}
                </>
              )}
            </details>
            <div className="border-border grid overflow-hidden rounded-xl border lg:grid-cols-[300px_minmax(0,1fr)]">
              <ol
                aria-label={i18n.t('Workflow steps')}
                className="border-border max-h-[65vh] space-y-1 overflow-auto border-r p-2"
              >
                {run.manifest.steps.map((s, index) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={step?.id === s.id}
                      className={`w-full rounded-lg p-3 text-left ${step?.id === s.id ? 'bg-accent/10 text-accent' : 'hover:bg-fg/5'}`}
                      onClick={() => setStepId(s.id)}
                    >
                      <span className="block truncate text-xs">
                        {i18n.number(index + 1)}. {s.title || s.id}
                      </span>
                      <span className="text-fg-muted text-[11px]">
                        {pipelineStatus(run.steps[s.id]?.status ?? 'pending')}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {step && state && (
                <section className="max-h-[65vh] min-w-0 space-y-4 overflow-auto p-5">
                  <h4 className="text-sm font-semibold">{step.title || step.id}</h4>
                  {state.error && (
                    <p className="text-status-error text-xs">{pipelineMessage(state.error)}</p>
                  )}
                  {step.message && <p className="text-sm whitespace-pre-wrap">{step.message}</p>}
                  {state.status === 'awaiting_approval' && run.state === 'awaiting_approval' && (
                    <button
                      type="button"
                      className={`${button} bg-accent text-accent-fg`}
                      disabled={busy}
                      onClick={() => void act('approve', step.id)}
                    >
                      {i18n.t('Approve and continue')}
                    </button>
                  )}
                  {(state.status === 'failed' || reviewNeedsPass) && (
                    <button
                      type="button"
                      className={button}
                      disabled={
                        busy || Object.values(run.steps).some((s) => s.status === 'running')
                      }
                      onClick={() =>
                        void act(extraReview || reviewNeedsPass ? 'extra_review' : 'retry', step.id)
                      }
                    >
                      {extraReview || reviewNeedsPass
                        ? i18n.t('Allow one more review')
                        : i18n.t('Retry failed step')}
                    </button>
                  )}
                  {((state.status === 'failed' && extraReview) || reviewNeedsPass) && (
                    <p className="text-fg-muted text-xs">
                      {i18n.t(
                        'The limit was reached. After making manual corrections, you can authorize one additional verification and review.',
                      )}
                    </p>
                  )}
                  {step.type === 'agent' && (
                    <dl className="text-fg-muted grid grid-cols-2 gap-2 text-xs">
                      <dt>{i18n.t('Model')}</dt>
                      <dd>{step.model || i18n.t('Agent default')}</dd>
                      <dt>{i18n.t('Mode')}</dt>
                      <dd>{step.capture ? i18n.t('Plan') : step.mode || i18n.t('Agent')}</dd>
                    </dl>
                  )}
                  {step.type !== 'human' && (
                    <details open>
                      <summary className="cursor-pointer text-xs">
                        {step.type === 'shell' ? i18n.t('Terminal command') : i18n.t('Prompt')}
                      </summary>
                      <pre className="text-fg-muted mt-2 text-xs break-words whitespace-pre-wrap">
                        {step.command || step.prompt || step.completeIf}
                      </pre>
                    </details>
                  )}
                  {state.attempts.map((a, index) => (
                    <details key={a.id} className="border-border rounded-lg border p-3">
                      <summary className="cursor-pointer text-xs">
                        {step.capture
                          ? i18n.t('Review round {round} · attempt {attempt}', {
                              round: a.round,
                              attempt: index + 1,
                            })
                          : i18n.t('Attempt {attempt}', { attempt: index + 1 })}{' '}
                        · {a.outcome}
                      </summary>
                      {a.session_id && onOpenSession && (
                        <button
                          type="button"
                          className={`${button} mt-2`}
                          onClick={() => onOpenSession(a.session_id!)}
                        >
                          {i18n.t('Open conversation')}
                        </button>
                      )}
                      {a.exit_code !== null && (
                        <p className="text-fg-muted mt-2 text-xs">
                          {i18n.t('Exit code: {code}', { code: a.exit_code })}
                        </p>
                      )}
                      <pre className="text-fg-muted mt-2 text-[11px] break-words whitespace-pre-wrap">
                        {a.output}
                      </pre>
                    </details>
                  ))}
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
