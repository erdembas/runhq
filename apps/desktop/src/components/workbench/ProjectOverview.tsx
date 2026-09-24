import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  FileText,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  ListTodo,
  Play,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import { AgentStatusBadge } from '@runhq/cockpit-ui';
import { EditorDropdown } from '@/components/EditorDropdown';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { useAppStore } from '@/store/useAppStore';
import { useAgentStore } from '@/store/useAgentStore';
import { openAgentTask, openProjectAgentView, openProjectSection } from '@/lib/workbenchNavigation';
import { ipc } from '@/lib/ipc';
import { recentProjectTasks } from './projectWorkbenchModel';
import { ProjectReadmePreview } from './ProjectReadmePreview';
import type { ServiceDef } from '@/types';

export function ProjectOverview({ service, visible }: { service: ServiceDef; visible: boolean }) {
  i18n.useLocale();
  const status = useAppStore((s) => s.statuses[service.id]);
  const meta = useAppStore((s) => s.overview?.projects.find((p) => p.service_id === service.id));
  const sessions = useAgentStore((s) => s.sessions);
  const projects = useAgentStore((s) => s.projects);
  const ready = useAgentStore((s) => s.ready);
  const storeError = useAgentStore((s) => s.error);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMemo(
    () => recentProjectTasks(service.cwd, projects, sessions),
    [service.cwd, projects, sessions],
  );
  useEffect(() => {
    if (visible && !ready)
      void useAgentStore
        .getState()
        .refresh()
        .catch((cause) => setError(String(cause)));
  }, [visible, ready]);
  const act = (operation: Promise<unknown>) => {
    setError(null);
    void operation.catch((cause) => setError(String(cause)));
  };
  const running = status?.status === 'running' || status?.status === 'starting';
  const resources = [
    {
      id: 'git' as const,
      icon: GitBranch,
      title: i18n.t('Git'),
      description: meta?.git_status?.branch ?? i18n.t('Review changes and history'),
    },
    {
      id: 'docs' as const,
      icon: BookOpen,
      title: i18n.t('Docs'),
      description: i18n.t('Read project documentation'),
    },
    {
      id: 'notes' as const,
      icon: FileText,
      title: i18n.t('Notes'),
      description: i18n.t('Keep project notes'),
    },
    {
      id: 'health' as const,
      icon: ShieldCheck,
      title: i18n.t('Health'),
      description: i18n.t('Review dependencies and licenses'),
    },
  ];
  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-7">
        <header>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-fg-dim font-semibold tracking-[0.12em] uppercase">
              {i18n.t('Project overview')}
            </span>
            <span className="text-fg-dim">·</span>
            <StatusPill status={status?.status ?? 'stopped'} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-fg text-[27px] font-semibold tracking-tight break-words">
                {service.name}
              </h1>
              <button
                type="button"
                onClick={() => act(ipc.openPath(service.cwd))}
                className="text-fg-muted hover:text-fg mt-2 flex max-w-full items-center gap-1.5 text-left font-mono text-[11px]"
                title={service.cwd}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{service.cwd}</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <EditorDropdown cwd={service.cwd} cmds={service.cmds} size="sm" />
              <button
                type="button"
                onClick={() => useAppStore.getState().openEditor(service)}
                className="text-fg-muted hover:bg-surface-raised rounded-lg p-2"
                title={i18n.t('Edit')}
                aria-label={i18n.t('Edit')}
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act(openProjectAgentView(service.id, 'conversations'))}
              className="bg-accent flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium text-white"
            >
              <ListTodo className="h-4 w-4" />
              {i18n.t('Open project tasks')}
            </button>
            <button
              type="button"
              onClick={() => act(openProjectAgentView(service.id, 'workflows'))}
              className="border-border text-fg hover:bg-surface-raised flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px]"
            >
              <GitPullRequest className="h-4 w-4" />
              {i18n.t('Workflows')}
            </button>
            <button
              type="button"
              onClick={() => openProjectSection(service.id, 'run')}
              className="border-border text-fg hover:bg-surface-raised flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px]"
            >
              <Terminal className="h-4 w-4" />
              {i18n.t('Run')}
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="text-status-error text-sm">
            {error}
          </p>
        )}
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="border-border overflow-hidden rounded-xl border">
            <div className="border-border bg-surface-raised/30 flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-fg text-[13px] font-medium">{i18n.t('Project commands')}</h2>
              {service.cmds.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    act(running ? ipc.stopService(service.id) : ipc.startService(service.id))
                  }
                  className="text-fg-muted hover:text-fg flex items-center gap-1.5 text-xs"
                >
                  {running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {running ? i18n.t('Stop all') : i18n.t('Start all')}
                </button>
              )}
            </div>
            {service.cmds.length === 0 && (
              <p className="text-fg-muted px-4 py-6 text-sm">{i18n.t('No commands configured.')}</p>
            )}
            {service.cmds.map((cmd) => {
              const state =
                status?.commands.find((entry) => entry.name === cmd.name)?.status ?? 'stopped';
              const active = state === 'running' || state === 'starting';
              return (
                <div
                  key={cmd.name}
                  className="border-border/50 flex items-center gap-3 border-b px-4 py-3 last:border-0"
                >
                  <StatusDot status={state} size="sm" />
                  <button
                    type="button"
                    onClick={() => {
                      openProjectSection(service.id, 'run');
                      useAppStore.getState().setSelectedCmd(cmd.name);
                    }}
                    className="min-w-0 flex-1 text-left"
                    title={i18n.t('Open command logs')}
                  >
                    <span className="text-fg block truncate text-[13px] font-medium">
                      {cmd.name}
                    </span>
                    <span className="text-fg-dim mt-1 block truncate font-mono text-[11px]">
                      {cmd.cmd}
                    </span>
                  </button>
                  <StatusPill status={state} />
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        active
                          ? ipc.stopServiceCmd(service.id, cmd.name)
                          : ipc.startServiceCmd(service.id, cmd.name),
                      )
                    }
                    title={active ? i18n.t('Stop') : i18n.t('Start')}
                    aria-label={active ? i18n.t('Stop') : i18n.t('Start')}
                    className="text-fg-muted hover:bg-surface-raised rounded-md p-2"
                  >
                    {active ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </section>
          <section className="border-border overflow-hidden rounded-xl border">
            <div className="border-border bg-surface-raised/30 flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-fg text-[13px] font-medium">{i18n.t('Recent project tasks')}</h2>
              <button
                type="button"
                onClick={() => act(openProjectAgentView(service.id, 'conversations'))}
                title={i18n.t('View all tasks')}
                aria-label={i18n.t('View all tasks')}
                className="text-fg-muted hover:text-fg"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {!ready ? (
              <p className="text-fg-muted p-5 text-sm">{i18n.t('Loading…')}</p>
            ) : storeError ? (
              <p role="alert" className="text-status-error p-5 text-xs">
                {i18n.t('Project task data could not be loaded: {message}', {
                  message: storeError,
                })}
              </p>
            ) : tasks.length === 0 ? (
              <p className="text-fg-muted p-5 text-sm">{i18n.t('No tasks in this project yet.')}</p>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openAgentTask(task.id)}
                  className="border-border/50 hover:bg-surface-raised flex w-full items-center justify-between gap-3 border-b px-4 py-3.5 text-left last:border-0"
                >
                  <span className="text-fg min-w-0 truncate text-[13px]">{task.title}</span>
                  <AgentStatusBadge status={task.status} />
                </button>
              ))
            )}
          </section>
        </div>
        <section>
          <h2 className="text-fg-muted mb-3 text-[11px] font-semibold tracking-[0.1em] uppercase">
            {i18n.t('Project resources')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {resources.map(({ id, icon: Icon, title, description }) => (
              <button
                key={id}
                type="button"
                onClick={() => openProjectSection(service.id, id)}
                className="border-border hover:border-accent/35 group flex items-start gap-3 rounded-xl border p-4 text-left transition"
              >
                <Icon className="text-fg-dim group-hover:text-accent mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="text-fg block text-[13px] font-medium">{title}</span>
                  <span className="text-fg-dim mt-1.5 block truncate text-[11px]">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
        <ProjectReadmePreview serviceId={service.id} cwd={service.cwd} visible={visible} />
      </div>
    </div>
  );
}
