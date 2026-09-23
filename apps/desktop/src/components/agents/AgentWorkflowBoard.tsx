import { CircleCheck, CircleHelp, GitBranch, Inbox, Loader2, Lock } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import type { AgentWorkflow, WorkflowStep } from '@/lib/ipc/agentWorkflowIpc';
import {
  groupWorkflowTasks,
  workflowBlockedBy,
  workflowDependents,
  workflowProgress,
  type WorkflowTaskLane,
} from './agentWorkflowGraph';
import { WORKFLOW_ROLE_OPTIONS } from './agentWorkflowStepPolicy';

/**
 * Where every task of a running workflow stands.
 *
 * A list could show a chain; a graph needs lanes, because several tasks are live at once and the
 * interesting question is not "what is next" but "what needs me, what is moving, and what is waiting
 * on what". The lanes and their words are Mission Control's, so one board reads like the other.
 */
const lanes = [
  {
    id: 'attention',
    label: 'Needs you',
    empty: 'Nothing is waiting on you.',
    icon: CircleHelp,
    tone: 'text-accent',
    dot: 'bg-accent',
  },
  {
    id: 'working',
    label: 'Working',
    empty: 'Running tasks appear here.',
    icon: Loader2,
    tone: 'text-cat-frontend',
    dot: 'bg-cat-frontend',
  },
  {
    id: 'ready',
    label: 'Ready',
    empty: 'Tasks that can start appear here.',
    icon: Inbox,
    tone: 'text-fg-muted',
    dot: 'bg-fg-dim',
  },
  {
    id: 'blocked',
    label: 'Waiting',
    empty: 'Tasks waiting for another task appear here.',
    icon: Lock,
    tone: 'text-fg-dim',
    dot: 'bg-fg-dim',
  },
  {
    id: 'completed',
    label: 'Done',
    empty: 'Finished tasks appear here.',
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
  const steps = workflow.steps ?? [];
  const grouped = groupWorkflowTasks(steps, sessions);
  const progress = workflowProgress(steps, sessions);
  const dependents = workflowDependents(steps);
  const summary = [
    progress.attention && `${progress.attention} need you`,
    progress.working && `${progress.working} working`,
    progress.ready && `${progress.ready} ready`,
    progress.blocked && `${progress.blocked} waiting`,
    progress.completed && `${progress.completed} done`,
  ].filter(Boolean) as string[];

  const card = (step: WorkflowStep, lane: WorkflowTaskLane) => {
    const session = step.session_id ? sessions[step.session_id] : undefined;
    const waiting = workflowBlockedBy(steps, step.id);
    const blocks = dependents[step.id]?.length ?? 0;
    return (
      <li key={step.id} className="border-fg/8 bg-bg space-y-1 rounded-lg border p-2">
        <div className="flex items-center gap-1.5">
          <span className="border-fg/10 text-fg-muted rounded border px-1 font-mono text-[10px]">
            {step.id}
          </span>
          <span className="text-fg-dim text-[10px]">{roleLabel(step.role)}</span>
          {step.workspace === 'own' && (
            <GitBranch className="text-fg-dim size-3" aria-label="Runs in a worktree of its own" />
          )}
        </div>
        <p className="text-fg line-clamp-2 text-[12px]" title={step.prompt || workflow.objective}>
          {step.prompt || workflow.objective}
        </p>
        <p className="text-fg-dim text-[10px]">{providerName(step.target)}</p>
        {waiting.length > 0 && (
          <p className="text-fg-dim text-[10px]">waiting on {waiting.join(', ')}</p>
        )}
        {blocks > 0 && lane !== 'completed' && (
          <p className="text-fg-dim text-[10px]">
            blocks {blocks} task{blocks === 1 ? '' : 's'}
          </p>
        )}
        {step.merge?.status === 'conflict' && (
          <p className="text-warning text-[10px]">
            Result held back: it conflicts with this workflow&rsquo;s checkout.
          </p>
        )}
        {step.error && <p className="text-warning line-clamp-2 text-[10px]">{step.error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {lane === 'ready' && (
            <button
              type="button"
              disabled={busy}
              className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
              onClick={() => onStart(step.id)}
            >
              Start
            </button>
          )}
          {step.status === 'failed' && (
            <button
              type="button"
              disabled={busy || waiting.length > 0}
              className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
              onClick={() => onStart(step.id)}
            >
              Retry
            </button>
          )}
          {session && (
            <button
              type="button"
              className="text-fg-muted hover:text-fg text-[11px] underline-offset-2 hover:underline"
              onClick={() => onOpen(session.id)}
            >
              {session.pending.length ? 'Answer' : 'Open'}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-2" aria-label="Workflow tasks">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-fg-muted text-[11px]">
          {progress.total} task{progress.total === 1 ? '' : 's'}
          {summary.length ? ` · ${summary.join(' · ')}` : ''}
        </p>
        {progress.ready > 0 && (
          <button
            type="button"
            disabled={busy}
            className="border-fg/15 hover:bg-fg/5 rounded-lg border px-2 py-0.5 text-[11px] disabled:opacity-40"
            onClick={onStartReady}
          >
            Start {progress.ready} unblocked
          </button>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          const items = grouped[lane.id];
          return (
            <div key={lane.id} className="border-fg/8 bg-fg/2 space-y-1.5 rounded-xl border p-2">
              <div className="flex items-center gap-1.5">
                <Icon className={`size-3.5 ${lane.tone}`} />
                <span className="text-fg text-[11px]">{lane.label}</span>
                <span className={`ml-auto size-1.5 rounded-full ${lane.dot}`} />
                <span className="text-fg-dim text-[10px]">{items.length}</span>
              </div>
              {items.length ? (
                <ul className="space-y-1.5">{items.map((step) => card(step, lane.id))}</ul>
              ) : (
                <p className="text-fg-dim text-[10px]">{lane.empty}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
