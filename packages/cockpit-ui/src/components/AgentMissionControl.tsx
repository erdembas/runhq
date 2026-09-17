'use client';

import {
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  GitBranch,
  Inbox,
  ListChecks,
  Loader2,
  Plus,
} from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import { groupAgentTasks, type AgentTaskLane } from '../lib/agentMissionControl';
import { AgentProviderLogo } from './AgentProviderLogo';
import { AgentStatusBadge } from './AgentStatusBadge';
import { agentProviderNames } from './agentProviders';
import { AgentTaskTemplates, type AgentTaskTemplate } from './AgentTaskTemplates';

const lanes = [
  {
    id: 'attention',
    label: 'Needs attention',
    detail: 'Questions, approvals & issues',
    empty: 'All clear. No tasks need your attention.',
    icon: CircleHelp,
    tone: 'text-accent',
    background: 'bg-accent/10',
    dot: 'bg-accent',
  },
  {
    id: 'working',
    label: 'Working',
    detail: 'Agents making progress',
    empty: 'Running tasks will appear here.',
    icon: Loader2,
    tone: 'text-cat-frontend',
    background: 'bg-cat-frontend/10',
    dot: 'bg-cat-frontend',
  },
  {
    id: 'ready',
    label: 'Ready',
    detail: 'Ready to start or continue',
    empty: 'New and stopped tasks will appear here.',
    icon: Inbox,
    tone: 'text-fg-muted',
    background: 'bg-fg/6',
    dot: 'bg-fg-dim',
  },
  {
    id: 'completed',
    label: 'Completed',
    detail: 'Agent responses ready to review',
    empty: 'Completed responses will appear here.',
    icon: CircleCheck,
    tone: 'text-status-running',
    background: 'bg-status-running/10',
    dot: 'bg-status-running',
  },
] as const;

function TaskCard({ session, onSelect }: { session: AgentSession; onSelect: () => void }) {
  const request = session.pending[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group border-border bg-surface-raised hover:border-fg/20 focus-visible:ring-accent/40 w-full rounded-xl border p-3.5 text-left shadow-[0_2px_6px_rgb(0_0_0/0.025)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="border-border/70 text-fg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border">
          <AgentProviderLogo backend={session.backend} className="h-4 w-4" />
        </span>
        <span className="text-fg-dim min-w-0 flex-1 truncate text-[10px]">
          {session.backend_name || agentProviderNames[session.backend] || session.backend}
        </span>
        {session.unread && (
          <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-label="Unread update" />
        )}
        <ArrowUpRight className="text-fg-dim group-hover:text-fg h-3.5 w-3.5" aria-hidden />
      </div>
      <h4 className="text-fg mb-1.5 line-clamp-2 text-[13px] leading-5 font-medium break-words">
        {session.title}
      </h4>
      <p className="text-fg-dim truncate text-[11px]">{session.project_name}</p>
      {request ? (
        <p className="text-accent bg-accent/6 mt-3 line-clamp-2 rounded-md px-2 py-1.5 text-[11px] leading-relaxed break-words">
          {request.title ||
            (request.kind === 'approval' ? 'Approval requested' : 'Your answer is needed')}
        </p>
      ) : session.last_error ? (
        <p className="text-status-error mt-3 line-clamp-2 text-[11px] leading-relaxed break-words">
          {session.last_error}
        </p>
      ) : null}
      <div className="border-border/60 mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <AgentStatusBadge status={session.status} />
        <span className="text-fg-dim flex items-center gap-1.5 text-[10px]">
          {session.mode === 'plan' && (
            <span title="Plan mode">
              <ListChecks className="h-3.5 w-3.5" aria-label="Plan mode" />
            </span>
          )}
          {session.isolated && (
            <span title={session.branch || 'Isolated worktree'}>
              <GitBranch className="h-3.5 w-3.5" aria-label="Isolated worktree" />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

export function AgentMissionControl({
  sessions,
  loading = false,
  archived = false,
  canCreate = true,
  onSelect,
  onNewTask,
  onTemplate,
  onLane,
}: {
  sessions: AgentSession[];
  loading?: boolean;
  archived?: boolean;
  canCreate?: boolean;
  onSelect: (sessionId: string) => void;
  onNewTask: () => void;
  onTemplate: (template: AgentTaskTemplate) => void;
  onLane?: (lane: AgentTaskLane) => void;
}) {
  const groups = groupAgentTasks(sessions);
  return (
    <section
      className="overlay-scroll min-h-0 min-w-0 flex-1 overflow-auto"
      aria-label="Agent mission control"
    >
      <div className="mx-auto max-w-[1600px] space-y-6 p-5 lg:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-accent mb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
              Mission control
            </p>
            <h2 className="text-fg text-[22px] font-semibold tracking-tight">
              Your agents, in the flow.
            </h2>
            <p className="text-fg-muted mt-1.5 text-[12px]">
              {archived
                ? 'Browse your archived conversations.'
                : 'Follow the work. Unblock your agents. Keep ideas moving.'}
            </p>
          </div>
          <span className="text-fg-dim border-border bg-surface-raised inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${groups.working.length ? 'bg-status-running' : 'bg-fg-dim'}`}
            />
            {loading
              ? 'Loading workspace…'
              : `${sessions.length} ${archived ? 'archived ' : ''}task${sessions.length === 1 ? '' : 's'} in this view`}
          </span>
        </div>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,165px),1fr))] gap-3"
          aria-label="Task status summary"
        >
          {lanes.map(({ id, label, detail, icon: Icon, tone, background }) => (
            <button
              key={id}
              type="button"
              disabled={!onLane}
              onClick={() => onLane?.(id)}
              className="border-border bg-surface-raised hover:border-fg/20 focus-visible:ring-accent/40 rounded-xl border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-muted text-[11px] font-medium">{label}</span>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${background} ${tone}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
              </div>
              <span className="text-fg mt-1.5 block text-[30px] leading-tight font-semibold tabular-nums">
                {loading ? '—' : groups[id].length}
              </span>
              <span className="text-fg-dim mt-1 block text-[10px]">{detail}</span>
            </button>
          ))}
        </div>
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg text-[12px] font-medium">
              {archived ? 'Archived tasks' : 'Task board'}
            </h3>
            <button
              type="button"
              onClick={onNewTask}
              disabled={!canCreate}
              className="text-fg-muted hover:text-fg flex items-center gap-1.5 text-[11px] disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              New task
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] items-start gap-3">
            {lanes.map(({ id, label, empty, dot }) => (
              <section
                key={id}
                aria-label={`${label} tasks`}
                className="bg-surface-muted/65 border-border/70 min-w-0 rounded-xl border p-2.5"
              >
                <div className="flex items-center gap-2 px-1 py-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  <h3 className="text-fg-muted flex-1 text-[11px] font-medium">{label}</h3>
                  <span className="text-fg-dim bg-fg/5 min-w-5 rounded px-1.5 py-0.5 text-center text-[10px] tabular-nums">
                    {groups[id].length}
                  </span>
                </div>
                <div className="mt-2 space-y-2.5">
                  {groups[id].map((session) => (
                    <TaskCard
                      key={session.id}
                      session={session}
                      onSelect={() => onSelect(session.id)}
                    />
                  ))}
                  {!groups[id].length && (
                    <p className="text-fg-dim border-border/70 flex min-h-32 items-center justify-center rounded-lg border border-dashed px-5 text-center text-[11px] leading-relaxed">
                      {loading ? 'Loading tasks…' : empty}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="border-border/70 border-t pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg text-[12px] font-medium">Give your next idea a head start</h3>
            <span className="text-fg-dim text-[10px]">
              Choose a starting point, then make it yours
            </span>
          </div>
          <AgentTaskTemplates onSelect={onTemplate} disabled={!canCreate} />
        </div>
      </div>
    </section>
  );
}
