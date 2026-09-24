import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { CircleCheck, CircleHelp, GitBranch, Inbox, Loader2, Lock } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import { SearchableSelect } from '@runhq/cockpit-ui';
import type { AgentWorkflow, WorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  groupWorkflowTasks,
  workflowBlockedBy,
  workflowDependents,
  workflowProgress,
  workflowReviewNeedsDecision,
  type WorkflowTaskLane,
} from './agentWorkflowGraph';
import { WORKFLOW_ROLE_OPTIONS } from './agentWorkflowStepPolicy';
import { AgentWorkflowStudio } from './AgentWorkflowStudio';
import { AgentWorkflowCanvas } from './AgentWorkflowCanvas';
import { AgentWorkflowViewToggle } from './AgentWorkflowViewToggle';
import { workflowStepTitle } from './agentWorkflowEditor';

/** Status labels are shared by the workflow map and its alternative list view. */
const lanes = [
  {
    id: 'attention',
    get label() {
      return i18n.t('Needs you');
    },
    get empty() {
      return i18n.t('Nothing is waiting on you.');
    },
    icon: CircleHelp,
    tone: 'text-accent',
    dot: 'bg-accent',
  },
  {
    id: 'working',
    get label() {
      return i18n.t('Working');
    },
    get empty() {
      return i18n.t('Running tasks appear here.');
    },
    icon: Loader2,
    tone: 'text-cat-frontend',
    dot: 'bg-cat-frontend',
  },
  {
    id: 'ready',
    get label() {
      return i18n.t('Ready');
    },
    get empty() {
      return i18n.t('Tasks that can start appear here.');
    },
    icon: Inbox,
    tone: 'text-fg-muted',
    dot: 'bg-fg-dim',
  },
  {
    id: 'blocked',
    get label() {
      return i18n.t('Waiting');
    },
    get empty() {
      return i18n.t('Tasks waiting for another task appear here.');
    },
    icon: Lock,
    tone: 'text-fg-dim',
    dot: 'bg-fg-dim',
  },
  {
    id: 'completed',
    get label() {
      return i18n.t('Done');
    },
    get empty() {
      return i18n.t('Finished tasks appear here.');
    },
    icon: CircleCheck,
    tone: 'text-status-running',
    dot: 'bg-status-running',
  },
] as const satisfies readonly { id: WorkflowTaskLane; [key: string]: unknown }[];

const roleLabel = (role: string) =>
  WORKFLOW_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;

export function AgentWorkflowBoard({
  workflow,
  sessions,
  providerName,
  busy,
  onStart,
  onOpen,
  onStartReady,
}: {
  workflow: AgentWorkflow;
  sessions: Record<string, AgentSession | undefined>;
  providerName: (target: string) => string;
  busy?: boolean;
  onStart: (stepId: string) => void;
  onOpen: (sessionId: string) => void;
  onStartReady: () => void;
}) {
  i18n.useLocale();
  const steps = workflow.steps ?? [];
  const grouped = groupWorkflowTasks(steps, sessions);
  const progress = workflowProgress(steps, sessions);
  const dependents = workflowDependents(steps);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | null>(null);
  const focused =
    steps.find((step) => step.id === selected) ??
    grouped.attention[0] ??
    grouped.working[0] ??
    grouped.ready[0] ??
    steps[0];
  const taskLanes = Object.fromEntries(
    (Object.entries(grouped) as [WorkflowTaskLane, WorkflowStep[]][]).flatMap(([lane, tasks]) =>
      tasks.map((task) => [task.id, lane]),
    ),
  );
  const canStart =
    !busy &&
    !workflow.editing &&
    !steps.some(workflowReviewNeedsDecision) &&
    !workflow.start_after &&
    !workflow.launch_pending &&
    !['launch_failed', 'launch_paused'].includes(workflow.stage) &&
    !workflow.cleaned &&
    !['integrated', 'integrating', 'setup_ready', 'setup_failed', 'setting_up'].includes(
      workflow.stage,
    );

  const card = (step: WorkflowStep, lane: WorkflowTaskLane) => {
    const session = step.session_id ? sessions[step.session_id] : undefined;
    const waiting = workflowBlockedBy(steps, step.id);
    const blocks = dependents[step.id]?.length ?? 0;
    return (
      <li key={step.id} className="border-fg/8 bg-bg space-y-1 rounded-lg border p-2">
        <div className="flex items-center gap-1.5">
          <span className="border-fg/10 text-fg-muted rounded border px-1 font-mono text-[10px]">
            {i18n.rich('Step {value1}', { value1: steps.indexOf(step) + 1 })}
          </span>
          <span className="text-fg-dim text-[10px]">{roleLabel(step.role)}</span>
          {step.workspace === 'own' && (
            <GitBranch
              className="text-fg-dim size-3"
              aria-label={i18n.t('Runs in a worktree of its own')}
            />
          )}
        </div>
        <p className="text-fg line-clamp-2 text-[12px]" title={step.prompt || workflow.objective}>
          {step.prompt || workflow.objective}
        </p>
        <p className="text-fg-dim text-[10px]">
          {providerName(step.target)} · {lanes.find((item) => item.id === lane)?.label}
        </p>
        {waiting.length > 0 && (
          <p className="text-fg-dim text-[10px]">
            {i18n.rich('Waiting for {value1}', {
              value1: waiting
                .map((id) =>
                  i18n.t('step {value1}', {
                    value1: steps.findIndex((entry) => entry.id === id) + 1,
                  }),
                )
                .join(', '),
            })}
          </p>
        )}
        {blocks > 0 && lane !== 'completed' && (
          <p className="text-fg-dim text-[10px]">
            {i18n.rich('blocks {blocks} task{plural2}', {
              blocks: blocks,
              plural2: blocks === 1 ? '' : 's',
            })}
          </p>
        )}
        {step.merge?.status === 'conflict' && (
          <p className="text-warning text-[10px]">
            {i18n.t('Result held back: it conflicts with this workflow’s checkout.')}
          </p>
        )}
        {step.error && <p className="text-warning line-clamp-2 text-[10px]">{step.error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {lane === 'ready' && (
            <button
              type="button"
              disabled={!canStart}
              className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
              onClick={() => onStart(step.id)}
            >
              {i18n.t('Start')}
            </button>
          )}
          {step.status === 'failed' && (
            <button
              type="button"
              disabled={!canStart || waiting.length > 0}
              className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
              onClick={() => onStart(step.id)}
            >
              {i18n.t('Retry')}
            </button>
          )}
          {session && (
            <button
              type="button"
              className="text-fg-muted hover:text-fg text-[11px] underline-offset-2 hover:underline"
              onClick={() => onOpen(session.id)}
            >
              {session.pending.length ? i18n.t('Answer') : i18n.t('Open')}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-2" aria-label={i18n.t('Workflow tasks')}>
      <AgentWorkflowStudio
        toolbar={
          <>
            <div className="min-w-0">
              <p className="text-fg flex items-center gap-2 text-xs font-semibold">
                {progress.working > 0 && (
                  <span className="bg-accent size-2 animate-pulse rounded-full" />
                )}
                {i18n.t('Live workflow')}
              </p>
              <p className="text-fg-dim mt-1 text-[11px]">
                {i18n.t('{completed} of {total} steps complete', {
                  completed: i18n.number(progress.completed),
                  total: i18n.number(progress.total),
                })}
              </p>
            </div>
            {progress.ready > 0 && canStart && (
              <button
                type="button"
                disabled={busy}
                className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
                onClick={onStartReady}
              >
                {i18n.rich('Start {value1} ready step{plural3}', {
                  value1: progress.ready,
                  plural3: progress.ready === 1 ? '' : 's',
                })}
              </button>
            )}
            <div className="ml-auto">
              <AgentWorkflowViewToggle value={view} onChange={setView} />
            </div>
          </>
        }
      >
        <div className="border-border bg-surface flex flex-wrap gap-4 border-b px-4 py-3">
          {lanes.map((lane) => (
            <span key={lane.id} className={`flex items-center gap-1.5 text-[11px] ${lane.tone}`}>
              <span className={`size-1.5 rounded-full ${lane.dot}`} />
              {lane.label}
              <span className="text-fg font-medium tabular-nums">
                {i18n.number(grouped[lane.id].length)}
              </span>
            </span>
          ))}
        </div>
        <div
          role="progressbar"
          aria-label={i18n.t('Live workflow')}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          className="bg-fg/5 h-1"
        >
          <div
            className="bg-status-running h-full transition-all duration-500"
            style={{
              width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
            }}
          />
        </div>
        <div hidden={view !== 'map'} className="workflow-studio-content min-h-0">
          <div className="grid h-full lg:grid-cols-[minmax(0,1fr)_300px]">
            <AgentWorkflowCanvas
              steps={steps}
              selected={focused?.id}
              onSelect={setSelected}
              providerName={providerName}
              lanes={taskLanes}
            />
            <div className="workflow-studio-inspector border-border overflow-auto border-t p-3 lg:border-t-0 lg:border-l">
              <label className="text-fg-muted mb-2 flex items-center gap-2 text-[11px]">
                {i18n.rich('Step details{value1}', {
                  value1: (
                    <SearchableSelect
                      label={i18n.t('Step details')}
                      className="min-w-0 flex-1"
                      value={focused?.id ?? ''}
                      onChange={setSelected}
                      options={steps.map((step, index) => ({
                        value: step.id,
                        label: `${i18n.number(index + 1)}. ${workflowStepTitle(step)}`,
                      }))}
                    />
                  ),
                })}
              </label>
              {focused && <ul>{card(focused, taskLanes[focused.id]!)}</ul>}
            </div>
          </div>
        </div>
        {view === 'list' && (
          <ol
            className="workflow-studio-content space-y-2 overflow-auto p-3"
            aria-label={i18n.t('Workflow queue')}
          >
            {steps.map((step) => card(step, taskLanes[step.id]!))}
          </ol>
        )}
      </AgentWorkflowStudio>
    </section>
  );
}
