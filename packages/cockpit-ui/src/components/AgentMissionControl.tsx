'use client';

import * as i18n from '../i18n';
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
    get label() {
      return i18n.t('Needs attention');
    },
    get detail() {
      return i18n.t('Questions, approvals & issues');
    },
    get empty() {
      return i18n.t('All clear. No tasks need your attention.');
    },
    icon: CircleHelp,
    tone: 'text-accent',
    background: 'bg-accent/10',
    dot: 'bg-accent',
  },
  {
    id: 'working',
    get label() {
      return i18n.t('Working');
    },
    get detail() {
      return i18n.t('Agents making progress');
    },
    get empty() {
      return i18n.t('Running tasks will appear here.');
    },
    icon: Loader2,
    tone: 'text-cat-frontend',
    background: 'bg-cat-frontend/10',
    dot: 'bg-cat-frontend',
  },
  {
    id: 'ready',
    get label() {
      return i18n.t('Ready');
    },
    get detail() {
      return i18n.t('Ready to start or continue');
    },
    get empty() {
      return i18n.t('New and stopped tasks will appear here.');
    },
    icon: Inbox,
    tone: 'text-fg-muted',
    background: 'bg-fg/6',
    dot: 'bg-fg-dim',
  },
  {
    id: 'completed',
    get label() {
      return i18n.t('Completed');
    },
    get detail() {
      return i18n.t('Agent responses ready to review');
    },
    get empty() {
      return i18n.t('Completed responses will appear here.');
    },
    icon: CircleCheck,
    tone: 'text-status-running',
    background: 'bg-status-running/10',
    dot: 'bg-status-running',
  },
] as const;

function TaskCard({ session, onSelect }: { session: AgentSession; onSelect: () => void }) {
  i18n.useLocale();
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
          <span
            className="bg-accent h-1.5 w-1.5 rounded-full"
            aria-label={i18n.t('Unread update')}
          />
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
            (request.kind === 'approval'
              ? i18n.t('Approval requested')
              : i18n.t('Your answer is needed'))}
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
            <span title={i18n.t('Plan mode')}>
              <ListChecks className="h-3.5 w-3.5" aria-label={i18n.t('Plan mode')} />
            </span>
          )}
          {session.isolated && (
            <span title={session.branch || i18n.t('Isolated worktree')}>
              <GitBranch className="h-3.5 w-3.5" aria-label={i18n.t('Isolated worktree')} />
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
  i18n.useLocale();
  const groups = groupAgentTasks(sessions);
  return (
    <section
      className="overlay-scroll min-h-0 min-w-0 flex-1 overflow-auto"
      aria-label={i18n.t('Agent mission control')}
    >
      <div className="mx-auto max-w-[1600px] space-y-6 p-5 lg:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-accent mb-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
              {i18n.t('Mission control')}
            </p>
            <h2 className="text-fg text-[22px] font-semibold tracking-tight">
              {i18n.t('Your agents, in the flow.')}
            </h2>
            <p className="text-fg-muted mt-1.5 text-[12px]">
              {archived
                ? i18n.t('Browse your archived conversations.')
                : i18n.t('Follow the work. Unblock your agents. Keep ideas moving.')}
            </p>
          </div>
          <span className="text-fg-dim border-border bg-surface-raised inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${groups.working.length ? 'bg-status-running' : 'bg-fg-dim'}`}
            />
            {loading
              ? i18n.t('Loading workspace…')
              : i18n.t('{value1} {value2}task{plural3} in this view', {
                  value1: sessions.length,
                  value2: archived ? i18n.t('archived ') : '',
                  plural3: sessions.length === 1 ? '' : 's',
                })}
          </span>
        </div>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,165px),1fr))] gap-3"
          aria-label={i18n.t('Task status summary')}
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
              {archived ? i18n.t('Archived tasks') : i18n.t('Task board')}
            </h3>
            <button
              type="button"
              onClick={onNewTask}
              disabled={!canCreate}
              className="text-fg-muted hover:text-fg flex items-center gap-1.5 text-[11px] disabled:opacity-40"
            >
              {i18n.rich('{value1}New task', { value1: <Plus className="h-3.5 w-3.5" /> })}
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] items-start gap-3">
            {lanes.map(({ id, label, empty, dot }) => (
              <section
                key={id}
                aria-label={i18n.t('{label} tasks', { label: label })}
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
                      {loading ? i18n.t('Loading tasks…') : empty}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="border-border/70 border-t pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg text-[12px] font-medium">
              {i18n.t('Give your next idea a head start')}
            </h3>
            <span className="text-fg-dim text-[10px]">
              {i18n.t('Choose a starting point, then make it yours')}
            </span>
          </div>
          <AgentTaskTemplates onSelect={onTemplate} disabled={!canCreate} />
        </div>
      </div>
    </section>
  );
}
