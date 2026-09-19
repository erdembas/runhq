import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  GitBranch,
  GitPullRequest,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import type { AgentItem } from '@runhq/cockpit-types';
import { agentIsActive, SearchableSelect } from '@runhq/cockpit-ui';
import {
  agentWorkflowIpc,
  type AgentWorkflow,
  type WorkflowCheck,
  type WorkflowWorktree,
} from '@/lib/ipc/agentWorkflowIpc';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentDiscovery } from './useAgentDiscovery';

export interface AgentWorkflowRecipe {
  title?: string;
  prompt: string;
  backend?: string;
  model?: string;
  effort?: string;
  reviewer?: string;
  setupCommands?: string[];
  checkCommands?: string[];
  acceptance?: string;
}
const field =
  'border-fg/15 bg-surface text-fg w-full rounded-lg border px-3 py-2 text-xs focus:border-accent focus:outline-none';
const button =
  'border-fg/15 hover:bg-fg/5 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40';
const label = 'text-fg-muted flex flex-col gap-1.5 text-xs';
const stages: Record<string, string> = {
  setup_ready: 'Setup ready',
  setting_up: 'Setting up',
  setup_failed: 'Setup failed',
  implementation_ready: 'Ready to implement',
  implementing: 'Implementing',
  implementation_failed: 'Implementation stopped',
  review_ready: 'Ready for review',
  reviewing: 'Reviewing',
  review_failed: 'Review stopped',
  checks_ready: 'Ready for checks',
  checking: 'Running checks',
  checks_failed: 'Checks failed',
  ready: 'Ready to apply',
  integrating: 'Applying',
  integrated: 'Applied',
  integration_failed: 'Apply failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
};
const lines = (value: string) =>
  value
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
const activeStages = ['setting_up', 'implementing', 'reviewing', 'checking', 'integrating'];

import { useAgentProjectOptions } from './useAgentProjectOptions';

export function AgentWorkflowHub({
  projectId,
  onOpenSession,
  visible = true,
  initialRecipe,
}: {
  projectId?: string;
  onOpenSession?: (id: string) => void;
  visible?: boolean;
  initialRecipe?: AgentWorkflowRecipe;
}) {
  const projects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const projectOptions = useAgentProjectOptions(projects, visible);
  const sessions = useVisibleStore(useAgentStore, (s) => s.sessions, visible);
  const tools = useVisibleStore(useAgentStore, (s) => s.tools, visible);
  useAgentDiscovery(visible);
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(!!initialRecipe);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState(projectId ?? '');
  const [backend, setBackend] = useState(initialRecipe?.backend ?? '');
  const [reviewer, setReviewer] = useState(initialRecipe?.reviewer ?? '');
  const [model, setModel] = useState(initialRecipe?.model ?? '');
  const [reviewModel, setReviewModel] = useState('');
  const [effort, setEffort] = useState(initialRecipe?.effort ?? '');
  const [autoProgress, setAutoProgress] = useState(false);
  const [objective, setObjective] = useState(initialRecipe?.prompt ?? '');
  const [acceptance, setAcceptance] = useState(initialRecipe?.acceptance ?? '');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [setup, setSetup] = useState(initialRecipe?.setupCommands?.join('\n') ?? '');
  const [checks, setChecks] = useState(initialRecipe?.checkCommands?.join('\n') ?? '');
  const [findings, setFindings] = useState<AgentItem[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [transferPaths, setTransferPaths] = useState('');
  const [inventory, setInventory] = useState<WorkflowWorktree[] | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const available = tools.filter(
    (t) => t.enabled !== false && t.available && t.adapter !== 'terminal',
  );
  const reviewers = available.filter((t) => ['codex', 'claude'].includes(t.adapter ?? t.id));
  const chosenProject = projectId || newProject || projects[0]?.id || '';
  const chosenBackend = backend || available[0]?.id || '';
  const chosenReviewer = reviewer || reviewers[0]?.id || '';
  const rows = workflows.filter((w) => !projectId || w.project_id === projectId);
  const current = rows.find((w) => w.id === selected) || rows[0];
  useEffect(() => {
    setTransferPaths('');
  }, [current?.id]);
  const loadInventory = async () => {
    setInventoryLoading(true);
    try {
      setInventory(await agentWorkflowIpc.inventory());
    } catch (e) {
      setError(String(e));
    } finally {
      setInventoryLoading(false);
    }
  };
  const refresh = useCallback(async () => {
    setWorkflows(await agentWorkflowIpc.list());
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await agentWorkflowIpc.list();
        if (live) setWorkflows(next);
      } catch (e) {
        if (live) setError(String(e));
      }
      if (live) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [visible]);
  const reviewId = current?.review_session_id;
  const reviewRevision = reviewId ? sessions[reviewId]?.revision : undefined;
  useEffect(() => {
    setAccepted(false);
  }, [
    current?.id,
    current?.review_fingerprint,
    current?.preview?.target_fingerprint,
    current?.stage,
  ]);
  useEffect(() => {
    setFindings([]);
    if (!visible || !reviewId) return;
    let live = true;
    void ipc
      .agentSnapshot(reviewId)
      .then((snapshot) => {
        if (live)
          setFindings(
            snapshot.items.filter((item) => item.kind === 'assistant' || item.kind === 'result'),
          );
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [reviewId, reviewRevision, visible]);
  const action = async (work: () => Promise<AgentWorkflow>) => {
    setBusy(true);
    setError(null);
    try {
      const workflow = await work();
      setWorkflows((previous) => [workflow, ...previous.filter((w) => w.id !== workflow.id)]);
      setSelected(workflow.id);
      await useAgentStore.getState().refresh(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) => {
    if (onOpenSession) onOpenSession(id);
    else useAgentStore.getState().select(id);
  };
  const create = () =>
    action(async () => {
      const workflow = await agentWorkflowIpc.create({
        project_id: chosenProject,
        backend: chosenBackend,
        model,
        effort,
        reviewer_backend: chosenReviewer,
        reviewer_model: reviewModel,
        objective,
        acceptance,
        base_ref: baseRef,
        setup_commands: lines(setup),
        check_commands: lines(checks),
        auto_progress: autoProgress,
      });
      setCreating(false);
      return workflow;
    });
  const running = !!current && activeStages.includes(current.stage);
  const implementationSession = current ? sessions[current.implementation_session_id] : undefined;
  const implementationActive =
    !!implementationSession && agentIsActive(implementationSession.status);
  const reviewActive =
    !!reviewId && !!sessions[reviewId] && agentIsActive(sessions[reviewId].status);
  return (
    <section aria-label="Agent workflows" className="bg-bg text-fg flex h-full min-h-0 flex-col">
      <header className="border-fg/10 flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequest className="text-accent h-4 w-4" /> Agent workflows
          </h2>
          <p className="text-fg-dim mt-1 text-xs">
            Implement → independent review → recorded checks → your approval
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={button}
            disabled={inventoryLoading}
            onClick={() => void loadInventory()}
          >
            {inventoryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}{' '}
            Worktrees
          </button>
          <button
            type="button"
            className={button}
            onClick={() => void refresh().catch((e) => setError(String(e)))}
            title="Refresh workflows"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={button} onClick={() => setCreating((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> New workflow
          </button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="border-danger/20 bg-danger/5 text-danger m-4 rounded-lg border p-3 text-xs"
        >
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {inventory && (
          <details open className="border-fg/10 mb-4 rounded-xl border p-4">
            <summary className="cursor-pointer text-xs font-medium">
              Worktree inventory ·{' '}
              {inventory.filter((entry) => !projectId || entry.project_id === projectId).length}
            </summary>
            <div className="mt-3 space-y-2">
              {inventory
                .filter((entry) => !projectId || entry.project_id === projectId)
                .map((entry) => (
                  <button
                    key={entry.session_id}
                    type="button"
                    onClick={() => {
                      if (entry.workflow_id) {
                        setSelected(entry.workflow_id);
                        setCreating(false);
                      } else open(entry.session_id);
                    }}
                    className="border-fg/10 hover:bg-fg/3 w-full rounded-lg border p-3 text-left"
                  >
                    <span className="flex flex-wrap gap-3 text-xs">
                      <strong>{entry.branch ?? 'Detached checkout'}</strong>
                      <span>
                        {entry.missing
                          ? 'Missing directory'
                          : entry.active
                            ? 'In use'
                            : entry.dirty
                              ? 'Contains changes'
                              : 'Clean'}
                      </span>
                      <span className="text-fg-dim">
                        {(entry.size_bytes / 1024 / 1024).toFixed(1)} MiB
                        {entry.size_incomplete ? ' or more' : ''}
                      </span>
                    </span>
                    <span className="text-fg-dim mt-1 block text-[10px] break-all">
                      {entry.path} · base {entry.base_revision.slice(0, 12)}
                    </span>
                    {entry.status && (
                      <pre className="text-fg-dim mt-2 max-h-24 overflow-auto text-[10px]">
                        {entry.status}
                      </pre>
                    )}
                  </button>
                ))}
            </div>
          </details>
        )}
        {creating ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
            className="mx-auto max-w-3xl space-y-4"
          >
            <p className="text-fg-muted text-xs">
              Create an isolated worktree from a committed base. Each step starts only when you
              choose it. After creation you can explicitly transfer selected environment files
              before setup.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Project
                <SearchableSelect
                  label="Workflow project"
                  indentGrouped
                  className="mt-1"
                  value={chosenProject}
                  disabled={!!projectId || busy}
                  options={projectOptions}
                  onChange={setNewProject}
                  searchPlaceholder="Find a project or group…"
                />
              </label>
              <label className={label}>
                Base branch or commit
                <input
                  className={field}
                  value={baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder="HEAD"
                />
              </label>
              <label className={label}>
                Implementation agent
                <SearchableSelect
                  label="Implementation agent"
                  searchable={false}
                  className="mt-1"
                  value={chosenBackend}
                  options={available.map((t) => ({ value: t.id, label: t.name }))}
                  onChange={setBackend}
                />
              </label>
              <label className={label}>
                Independent reviewer
                <SearchableSelect
                  label="Review agent"
                  searchable={false}
                  className="mt-1"
                  value={chosenReviewer}
                  options={reviewers.map((t) => ({
                    value: t.id,
                    label: t.name,
                    description: 'Read-only review',
                  }))}
                  onChange={setReviewer}
                />
              </label>
              <label className={label}>
                Implementation model
                <input
                  className={field}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Provider default"
                />
              </label>
              <label className={label}>
                Implementation effort
                <input
                  className={field}
                  value={effort}
                  onChange={(e) => setEffort(e.target.value)}
                  placeholder="Provider default"
                />
              </label>
              <label className={label}>
                Review model
                <input
                  className={field}
                  value={reviewModel}
                  onChange={(e) => setReviewModel(e.target.value)}
                  placeholder="Provider default"
                />
              </label>
            </div>
            {!reviewers.length && (
              <p className="text-warning text-xs">
                Connect Codex or Claude for a supported read-only independent review. Other
                providers can implement.
              </p>
            )}
            <label className={label}>
              Objective
              <textarea
                required
                rows={4}
                className={field}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="What should this workflow deliver?"
              />
            </label>
            <label className={label}>
              Acceptance criteria
              <textarea
                rows={3}
                className={field}
                value={acceptance}
                onChange={(e) => setAcceptance(e.target.value)}
                placeholder="What must be true for you to accept the result?"
              />
            </label>
            <label className={label}>
              Setup commands · optional, one per line
              <textarea
                rows={2}
                className={`${field} font-mono`}
                value={setup}
                onChange={(e) => setSetup(e.target.value)}
                placeholder="pnpm install --frozen-lockfile"
              />
            </label>
            <label className={label}>
              Required checks · one command per line
              <textarea
                required
                rows={3}
                className={`${field} font-mono`}
                value={checks}
                onChange={(e) => setChecks(e.target.value)}
                placeholder={'pnpm test\npnpm typecheck'}
              />
            </label>
            <label className="text-fg-muted flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={autoProgress}
                onChange={(e) => setAutoProgress(e.target.checked)}
              />
              After implementation completes, automatically run one independent review and the
              recorded checks. Pause on failure or restart; applying always waits for me.
            </label>
            <p className="text-fg-dim text-[11px]">
              Commands run in the isolated project directory with a 10 minute limit each. Their
              actual exit codes, output and workspace revision are retained.
            </p>
            <button
              className={`${button} bg-accent/10 text-accent`}
              disabled={
                busy ||
                !chosenProject ||
                !chosenBackend ||
                !chosenReviewer ||
                !objective.trim() ||
                !lines(checks).length
              }
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitBranch className="h-3.5 w-3.5" />
              )}{' '}
              Create isolated workflow
            </button>
          </form>
        ) : !current ? (
          <div className="text-fg-dim mx-auto max-w-lg py-14 text-center text-sm">
            <GitPullRequest className="mx-auto mb-4 h-8 w-8" />
            <p>
              Give implementation and review their own agents, keep check evidence with the change,
              and apply it when you are ready.
            </p>
            <button type="button" onClick={() => setCreating(true)} className={`${button} mt-5`}>
              Create your first workflow
            </button>
          </div>
        ) : (
          <div className="grid min-h-0 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
            <nav aria-label="Saved workflows" className="space-y-2">
              {rows.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={`border-fg/10 w-full rounded-xl border p-3 text-left ${w.id === current.id ? 'bg-accent/8 border-accent/30' : 'hover:bg-fg/3'}`}
                >
                  <span className="line-clamp-2 text-xs font-medium">{w.title}</span>
                  <span className="text-fg-dim mt-2 flex items-center gap-1.5 text-[11px]">
                    {activeStages.includes(w.stage) && <Loader2 className="h-3 w-3 animate-spin" />}
                    {stages[w.stage] ?? w.stage}
                    {w.cleaned ? ' · cleaned' : ''}
                  </span>
                </button>
              ))}
            </nav>
            <article className="min-w-0 space-y-4">
              <div className="border-fg/10 rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{current.title}</h3>
                  <span className="text-accent text-xs">
                    {stages[current.stage] ?? current.stage}
                  </span>
                </div>
                <p className="text-fg-muted mt-3 text-xs whitespace-pre-wrap">
                  {current.objective}
                </p>
                {current.acceptance && (
                  <p className="text-fg-dim mt-3 text-xs whitespace-pre-wrap">
                    <strong>Acceptance:</strong> {current.acceptance}
                  </p>
                )}
                <div className="text-fg-dim mt-4 space-y-1 font-mono text-[10px] break-all">
                  <p>Base: {current.base_revision}</p>
                  <p>Worktree: {current.cwd}</p>
                  <p>Destination: {current.target}</p>
                  <p>Reviewed tree: {current.review_fingerprint ?? 'Not reviewed'}</p>
                  <p>Current tree: {current.current_fingerprint ?? 'Available when idle'}</p>
                  <p>
                    Progression:{' '}
                    {current.auto_progress
                      ? 'Automatic review and checks · one pass'
                      : 'Start each step explicitly'}
                  </p>
                </div>
                {current.error && (
                  <p role="status" className="text-warning mt-3 text-xs">
                    {current.error}
                  </p>
                )}
              </div>
              {!current.cleaned &&
                ['setup_ready', 'setup_failed', 'implementation_ready'].includes(current.stage) && (
                  <details className="border-fg/10 rounded-xl border p-4">
                    <summary className="cursor-pointer text-xs font-medium">
                      Selected environment files
                    </summary>
                    <p className="text-fg-dim my-3 text-xs">
                      Copy only the files you name from the original project. Paths must be
                      project-relative, ignored by Git in this worktree and at most 1 MiB each.
                      Their contents stay outside saved history and integration patches.
                    </p>
                    <textarea
                      aria-label="Environment file paths"
                      className={`${field} font-mono`}
                      rows={2}
                      value={transferPaths}
                      onChange={(e) => setTransferPaths(e.target.value)}
                      placeholder={'.env.local\nconfig/local.env'}
                    />
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      disabled={busy || !lines(transferPaths).length}
                      onClick={() =>
                        void action(() =>
                          agentWorkflowIpc.transferFiles(current.id, lines(transferPaths)),
                        )
                      }
                    >
                      Copy selected files to worktree
                    </button>
                  </details>
                )}
              {current.transferred_files.length > 0 && (
                <details className="border-fg/10 rounded-xl border p-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    Transferred configuration · {current.transferred_files.length}
                  </summary>
                  {current.transferred_files.map((file) => (
                    <p key={file.path} className="text-fg-dim mt-2 text-[11px] break-all">
                      {file.path} · {file.size} bytes ·{' '}
                      {new Date(file.captured_at).toLocaleString()}
                      <br />
                      Source: {file.source}
                    </p>
                  ))}
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {current.setup_commands.length > 0 &&
                  ['setup_ready', 'setup_failed', 'interrupted', 'cancelled'].includes(
                    current.stage,
                  ) && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || running}
                      onClick={() => void action(() => agentWorkflowIpc.setup(current.id))}
                    >
                      <Play className="h-3.5 w-3.5" /> Run setup
                    </button>
                  )}
                {!current.cleaned &&
                  !running &&
                  current.stage !== 'integrated' &&
                  !['setup_ready', 'setup_failed'].includes(current.stage) && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || implementationActive || reviewActive}
                      onClick={() => void action(() => agentWorkflowIpc.implement(current.id))}
                    >
                      <Play className="h-3.5 w-3.5" />{' '}
                      {current.stage === 'implementation_ready'
                        ? 'Start implementation'
                        : 'Revise implementation'}
                    </button>
                  )}
                <button
                  type="button"
                  className={button}
                  onClick={() => open(current.implementation_session_id)}
                >
                  Open implementation
                </button>
                {!current.cleaned &&
                  !running &&
                  [
                    'review_ready',
                    'review_failed',
                    'checks_ready',
                    'checks_failed',
                    'ready',
                    'cancelled',
                    'interrupted',
                  ].includes(current.stage) && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || implementationActive || reviewActive}
                      onClick={() => void action(() => agentWorkflowIpc.review(current.id))}
                    >
                      Start independent review
                    </button>
                  )}
                {reviewId && (
                  <button type="button" className={button} onClick={() => open(reviewId)}>
                    Open review
                  </button>
                )}
                {!running &&
                  ['checks_ready', 'checks_failed', 'ready', 'cancelled', 'interrupted'].includes(
                    current.stage,
                  ) &&
                  current.review_fingerprint && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || implementationActive || reviewActive}
                      onClick={() => void action(() => agentWorkflowIpc.checks(current.id))}
                    >
                      <Check className="h-3.5 w-3.5" /> Run checks
                    </button>
                  )}
                {(running || implementationActive || reviewActive) && (
                  <button
                    type="button"
                    className={`${button} text-warning`}
                    onClick={() =>
                      void agentWorkflowIpc
                        .cancel(current.id)
                        .then(refresh)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <Square className="h-3.5 w-3.5" /> Stop workflow
                  </button>
                )}
                {current.stage === 'integrated' && !current.cleaned && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => void action(() => agentWorkflowIpc.cleanup(current.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove integrated worktree
                  </button>
                )}
              </div>
              {findings.length > 0 && (
                <details open className="border-fg/10 rounded-xl border p-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    Independent review findings
                  </summary>
                  <div className="text-fg-muted mt-3 max-h-72 overflow-auto text-xs whitespace-pre-wrap">
                    {findings.slice(-3).map((item) => (
                      <p key={item.id} className="mb-3">
                        {item.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              <Evidence title="Environment setup" items={current.setup} />
              <Evidence
                title="Recorded validation"
                items={current.checks}
                reviewedFingerprint={current.review_fingerprint}
                currentFingerprint={current.current_fingerprint}
              />
              {current.stage === 'ready' && (
                <div className="border-accent/25 space-y-3 rounded-xl border p-4">
                  <p className="text-fg-muted text-xs">
                    Review the findings and destination diff, then apply these changes to your
                    original project. Applying leaves the changes uncommitted for your normal Git
                    review.
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => void action(() => agentWorkflowIpc.preview(current.id))}
                  >
                    Preview destination and conflicts
                  </button>
                  {current.preview && (
                    <>
                      <p className="text-fg-dim text-xs break-all">
                        {current.preview.target} · {current.preview.target_branch} ·{' '}
                        {current.preview.target_fingerprint.slice(0, 12)}
                      </p>
                      {current.preview.conflict ? (
                        <p className="text-warning text-xs">{current.preview.conflict}</p>
                      ) : (
                        <p className="text-success text-xs">
                          Patch applies cleanly to the previewed destination.
                        </p>
                      )}
                      <pre className="bg-fg/3 max-h-80 overflow-auto rounded-lg p-3 text-[11px]">
                        {current.preview.patch}
                      </pre>
                      <label className="text-fg-muted flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(e) => setAccepted(e.target.checked)}
                        />
                        I reviewed the findings and this diff and accept applying it to the
                        displayed destination.
                      </label>
                      <button
                        type="button"
                        className={`${button} bg-accent/10 text-accent`}
                        disabled={busy || !accepted || !!current.preview.conflict}
                        onClick={() => void action(() => agentWorkflowIpc.integrate(current.id))}
                      >
                        Apply reviewed changes
                      </button>
                    </>
                  )}
                </div>
              )}
              {current.stage === 'integrated' && (
                <p className="text-success text-xs">
                  Changes were applied to {current.target}. Review and commit them from the project
                  Git view. The workflow evidence remains available.
                </p>
              )}
              {busy && (
                <p role="status" className="text-fg-dim flex items-center gap-2 text-xs">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving or running this step…
                </p>
              )}
            </article>
          </div>
        )}
      </div>
    </section>
  );
}
function Evidence({
  title,
  items,
  reviewedFingerprint,
  currentFingerprint,
}: {
  title: string;
  items: WorkflowCheck[];
  reviewedFingerprint?: string | null;
  currentFingerprint?: string | null;
}) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-fg-muted text-xs font-medium">{title}</h4>
      {items.map((item, index) => (
        <details key={`${item.started_at}-${index}`} className="border-fg/10 rounded-lg border p-3">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
            <span className={item.status === 'passed' ? 'text-success' : 'text-warning'}>
              {item.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                item.status
              )}
            </span>
            <code className="min-w-0 flex-1 break-all">{item.command}</code>
            <span className="text-fg-dim">exit {item.exit_code ?? '—'}</span>
            {reviewedFingerprint &&
              (item.fingerprint !== reviewedFingerprint ||
                item.fingerprint !== currentFingerprint) && (
                <span className="text-warning">stale</span>
              )}
          </summary>
          <p className="text-fg-dim mt-2 text-[10px] break-all">
            {item.cwd} · {new Date(item.started_at).toLocaleString()} · tree{' '}
            {item.fingerprint.slice(0, 12)}
          </p>
          <pre className="text-fg-muted mt-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap">
            {item.output || 'Waiting for the command to finish…'}
          </pre>
        </details>
      ))}
    </div>
  );
}
