import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { Folders, GitBranch, Pencil, Plus, ArrowUpRight } from 'lucide-react';
import type { AgentProject, AgentSession } from '@runhq/cockpit-types';
import { AgentStatusBadge } from '@runhq/cockpit-ui';
import { useAppStore } from '@/store/useAppStore';
import { StatusPill } from '@/components/ui/StatusDot';
import { Button } from '@/components/ui/Button';
import { openAgentTask, openProjectSection } from '@/lib/workbenchNavigation';
import { WorkspaceEditor } from './WorkspaceEditor';
import { WorkspaceRunGroup } from './WorkspaceRunGroup';
import { WorkspaceTaskSummary } from './WorkspaceTaskSummary';

export function WorkspaceOverview({
  project,
  sessions,
  visible,
  onNewTask,
}: {
  project: AgentProject;
  sessions: AgentSession[];
  visible: boolean;
  onNewTask: () => void;
}) {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const git = useAppStore((s) => s.git);
  const [editing, setEditing] = useState(false);
  const members = project.workspace?.members ?? [];
  const recent = sessions
    .filter((session) => session.project_id === project.id && !session.archived)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 6);
  const latest = recent.find((session) => session.status === 'completed');
  const running = members.filter((member) =>
    ['running', 'starting'].includes(statuses[member.service_id]?.status ?? ''),
  ).length;
  const dirty = members.reduce(
    (count, member) => count + (git[member.service_id]?.dirty_count ?? 0),
    0,
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-7 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-accent mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wider uppercase">
              <Folders className="h-4 w-4" />
              {i18n.t('Workspace overview')}
            </p>
            <h2 className="text-fg text-3xl font-semibold tracking-tight">{project.name}</h2>
            <p className="text-fg-dim mt-2 font-mono text-[11px] break-all">{project.path}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} leftIcon={<Pencil className="h-3.5 w-3.5" />}>
              {i18n.t('Edit workspace')}
            </Button>
            <Button
              variant="primary"
              onClick={onNewTask}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              {i18n.t('New task')}
            </Button>
          </div>
        </header>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: i18n.t('Included projects'), value: members.length },
            { label: i18n.t('Running'), value: running },
            { label: i18n.t('Changed files'), value: dirty },
          ].map((stat) => (
            <div key={stat.label} className="border-border rounded-xl border px-5 py-4">
              <p className="text-fg-dim text-[11px]">{stat.label}</p>
              <p className="text-fg mt-1 text-2xl font-semibold tabular-nums">
                {i18n.number(stat.value)}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {members.map((member) => {
            const service = services.find((entry) => entry.id === member.service_id);
            const state = git[member.service_id];
            return (
              <section
                key={member.service_id}
                className="border-border bg-surface-raised/20 rounded-xl border p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-fg truncate text-[13px] font-medium">{member.name}</h3>
                  {service && (
                    <StatusPill status={statuses[member.service_id]?.status ?? 'stopped'} />
                  )}
                </div>
                <p className="text-fg-dim mt-2 truncate font-mono text-[10px]" title={member.path}>
                  {member.path}
                </p>
                {!service ? (
                  <p className="text-status-warning mt-3 text-[11px]">
                    {i18n.t(
                      'Project is no longer available. Edit the workspace to update its members.',
                    )}
                  </p>
                ) : (
                  <div className="text-fg-muted mt-4 flex items-center justify-between gap-3 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {state === undefined
                          ? i18n.t('Loading Git status…')
                          : !state
                            ? i18n.t('No Git repository')
                            : (state.branch ?? state.head_short)}
                      </span>
                      {!!state?.dirty_count && (
                        <span className="text-status-warning shrink-0">
                          {i18n.number(state.dirty_count)}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => openProjectSection(service.id)}
                      className="text-accent flex shrink-0 items-center gap-1 hover:underline"
                    >
                      {i18n.t('Overview')}
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <WorkspaceRunGroup key={project.id} project={project} />
          <section className="border-border rounded-xl border p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-fg text-[13px] font-semibold">{i18n.t('Shared instructions')}</h2>
              <button
                onClick={() => setEditing(true)}
                className="text-accent text-[11px] hover:underline"
              >
                {i18n.t('Edit')}
              </button>
            </div>
            <p className="text-fg-muted max-h-56 overflow-auto text-[12px] leading-relaxed whitespace-pre-wrap">
              {project.workspace?.instructions || i18n.t('No shared instructions yet.')}
            </p>
            <p className="text-fg-dim mt-3 text-[11px]">
              {i18n.t('Task instructions are captured when the conversation starts.')}
            </p>
          </section>
        </div>
        <section className="border-border overflow-hidden rounded-xl border">
          <h2 className="text-fg px-5 py-4 text-[13px] font-semibold">
            {i18n.t('Recent workspace tasks')}
          </h2>
          {recent.length ? (
            recent.map((session) => (
              <button
                key={session.id}
                onClick={() => openAgentTask(session.id)}
                className="border-border/60 hover:bg-fg/3 flex w-full items-center gap-3 border-t px-5 py-3 text-left"
              >
                <span className="text-fg min-w-0 flex-1 truncate text-[12px]">{session.title}</span>
                <AgentStatusBadge status={session.status} />
                <span className="text-fg-dim text-[10px]">
                  {i18n.date(session.updated_at, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            ))
          ) : (
            <p className="text-fg-dim px-5 pb-5 text-[12px]">
              {i18n.t('No tasks in this workspace yet.')}
            </p>
          )}
        </section>
        {latest && <WorkspaceTaskSummary key={latest.id} session={latest} visible={visible} />}
      </div>
      {editing && visible && (
        <WorkspaceEditor
          project={project}
          sectionId={project.workspace?.section_id ?? ''}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
