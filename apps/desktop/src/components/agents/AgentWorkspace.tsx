import { useMemo, useState } from 'react';
import {
  Bot,
  Wrench,
  CircleHelp,
  FolderPlus,
  Plus,
  Search,
  Trash2,
  Loader2,
  LayoutDashboard,
  MessagesSquare,
  X,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  SearchableSelect,
  AgentProviderLogo,
  AgentStatusBadge,
  AgentMissionControl,
  agentTaskLane,
  agentIsActive,
  agentProviderNames,
} from '@runhq/cockpit-ui';
import type { AgentTaskTemplate } from '@runhq/cockpit-ui';
import type { AgentProject, AgentSession } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentProjectOptions } from './useAgentProjectOptions';
import { AgentNewSession } from './AgentNewSession';
import { AgentSessionView } from './AgentSessionView';
import { useVisibleStore } from '@/lib/useVisibleStore';

export function AgentWorkspace({ visible, project }: { visible: boolean; project?: AgentProject }) {
  const storedProjects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const projects = project ? [project] : storedProjects;
  const projectOptions = useAgentProjectOptions(storedProjects, visible);
  const sessions = useVisibleStore(useAgentStore, (s) => s.sessions, visible);
  const globalSelectedId = useVisibleStore(useAgentStore, (s) => s.selectedId, visible);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = project ? localSelectedId : globalSelectedId;
  const select = (id: string | null) => {
    if (project) setLocalSelectedId(id);
    else useAgentStore.getState().select(id);
  };
  const globalProjectFilter = useVisibleStore(useAgentStore, (s) => s.projectFilter, visible);
  const projectFilter = project?.id ?? globalProjectFilter;
  const ready = useVisibleStore(useAgentStore, (s) => s.ready, visible);
  const storeError = useVisibleStore(useAgentStore, (s) => s.error, visible);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'overview' | 'conversations'>(
    selectedId ? 'conversations' : 'overview',
  );
  const [template, setTemplate] = useState<AgentTaskTemplate | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<AgentSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'attention' | 'active' | 'ready' | 'completed' | 'archived'
  >('all');
  const [error, setError] = useState<string | null>(null);
  const all = Object.values(sessions).filter((s) => !project || s.project_id === project.id);
  const scoped = all.filter(
    (s) => !s.archived && (!projectFilter || s.project_id === projectFilter),
  );
  const needsAttention = scoped.filter((s) => agentTaskLane(s) === 'attention').length;
  const working = scoped.filter((s) => agentTaskLane(s) === 'working').length;
  const filtered = useMemo(
    () =>
      Object.values(sessions)
        .filter(
          (s) =>
            (filter === 'archived' ? s.archived : !s.archived) &&
            (!projectFilter || s.project_id === projectFilter) &&
            (filter !== 'attention' || agentTaskLane(s) === 'attention' || s.unread) &&
            (filter !== 'active' || agentTaskLane(s) === 'working') &&
            (filter !== 'ready' || agentTaskLane(s) === 'ready') &&
            (filter !== 'completed' || agentTaskLane(s) === 'completed') &&
            `${s.title} ${s.project_name} ${s.backend} ${s.model}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(b.pending.length > 0) - Number(a.pending.length > 0) ||
            b.updated_at - a.updated_at,
        ),
    [sessions, projectFilter, filter, search],
  );
  const candidate = selectedId ? sessions[selectedId] : null;
  const selected =
    candidate && (!project || candidate.project_id === project.id) ? candidate : null;
  const startTask = (nextTemplate?: AgentTaskTemplate) => {
    setTemplate(nextTemplate);
    setCreating(true);
    setView('conversations');
  };
  const openConversation = (id: string) => {
    select(id);
    setCreating(false);
    setView('conversations');
  };
  const deleteConversation = async (id: string) => {
    setDeleteTarget(null);
    setDeletingId(id);
    setError(null);
    try {
      await useAgentStore.getState().deleteSession(id);
      setLocalSelectedId((current) => (current === id ? null : current));
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletingId(null);
    }
  };
  const addProject = async () => {
    setError(null);
    try {
      const path = await open({ directory: true, multiple: false, title: 'Add an agent project' });
      if (typeof path !== 'string') return;
      const project = await ipc.agentAddProject('', path);
      await useAgentStore.getState().refresh(true);
      useAgentStore.setState({ projectFilter: project.id, selectedId: null });
      startTask();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col">
      {deleteTarget && (
        <ConfirmDialog
          title="Delete conversation?"
          message={`“${deleteTarget.title}” and its message history will be permanently removed from RunHQ. Project files, Git worktrees and the agent tool’s own history will be kept.`}
          confirmLabel="Delete conversation"
          onConfirm={() => void deleteConversation(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <header className="border-border flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3">
        <Bot className="text-accent h-5 w-5" />
        <h1 className="text-fg truncate text-[15px] font-semibold">
          {project ? `${project.name} agents` : 'Agents'}
        </h1>
        <span className="text-fg-dim text-[12px]">{working} working</span>
        {needsAttention > 0 && (
          <button
            onClick={() => {
              setFilter('attention');
              select(null);
              setCreating(false);
              setView('overview');
            }}
            className="text-accent flex items-center gap-1 text-[12px]"
          >
            <CircleHelp className="h-3.5 w-3.5" />
            {needsAttention} need you
          </button>
        )}
        <span className="flex-1" />
        <button
          onClick={() => useAgentStore.setState({ toolsOpen: true })}
          className="text-fg-muted hover:bg-fg/5 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px]"
        >
          <Wrench className="h-3.5 w-3.5" />
          Agent tools
        </button>
        {!project && (
          <button
            onClick={() => void addProject()}
            className="text-fg-muted hover:bg-fg/5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add project
          </button>
        )}
        <button
          disabled={!projects.length}
          onClick={() => startTask()}
          className="bg-accent text-surface flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          New task
        </button>
      </header>
      <div
        className="border-border/70 flex shrink-0 items-center gap-1 border-b px-5 py-2"
        role="group"
        aria-label="Agent workspace view"
      >
        {(
          [
            { value: 'overview', label: 'Overview', icon: LayoutDashboard },
            { value: 'conversations', label: 'Conversations', icon: MessagesSquare },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition-colors ${view === value ? 'bg-fg/7 text-fg font-medium' : 'text-fg-dim hover:text-fg hover:bg-fg/3'}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {(error || storeError) && (
        <div
          role="alert"
          className="text-status-error border-border flex items-center gap-2 border-b px-5 py-3 text-[12px]"
        >
          <span className="flex-1">{error || storeError}</span>
          <button
            onClick={() => {
              setError(null);
              void useAgentStore.getState().refresh();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div className={`flex min-h-0 min-w-0 flex-1 ${view === 'overview' ? 'flex-col' : ''}`}>
        <aside
          className={`border-border bg-surface-muted/60 flex shrink-0 flex-col ${view === 'overview' ? 'border-b' : `w-44 border-r md:w-56 ${project ? 'xl:w-64' : 'xl:w-72'}`}`}
          aria-label="Project agent sessions"
        >
          <div
            className={
              view === 'overview'
                ? 'flex flex-wrap items-center gap-3 px-5 py-3'
                : 'border-border/60 space-y-3 border-b p-3'
            }
          >
            {!project && (
              <SearchableSelect
                label="Filter by project"
                indentGrouped
                value={projectFilter}
                options={[
                  {
                    value: '',
                    label: 'All projects',
                    description: `${projects.length} projects in your workspace`,
                  },
                  ...projectOptions,
                ]}
                onChange={(value) => useAgentStore.setState({ projectFilter: value })}
                searchPlaceholder="Find a project or group…"
                className={view === 'overview' ? 'w-56 max-w-full' : 'w-full'}
              />
            )}
            <div
              className={`bg-surface border-border flex min-w-0 items-center gap-2 rounded-lg border px-2.5 ${view === 'overview' ? 'w-60 max-w-full' : ''}`}
            >
              <Search className="text-fg-dim h-3.5 w-3.5" />
              <input
                aria-label="Search agent sessions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                className="text-fg w-full bg-transparent py-2 text-[12px] outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(['all', 'attention', 'active', 'ready', 'completed', 'archived'] as const).map(
                (value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`rounded px-2 py-1 text-[11px] ${filter === value ? 'bg-fg/10 text-fg' : 'text-fg-dim hover:text-fg'}`}
                  >
                    {value === 'all'
                      ? 'All'
                      : value === 'attention'
                        ? 'Needs attention'
                        : value === 'active'
                          ? 'Working'
                          : value === 'ready'
                            ? 'Ready'
                            : value === 'completed'
                              ? 'Completed'
                              : 'Archived'}
                  </button>
                ),
              )}
            </div>
          </div>
          {view === 'conversations' && (
            <div className="overlay-scroll flex-1 overflow-auto p-2">
              {filtered.map((s) => (
                <div key={s.id} className="group relative mb-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      openConversation(s.id);
                    }}
                    className={`w-full space-y-2 rounded-xl border p-3 text-left transition-colors ${selectedId === s.id && !creating ? 'border-accent/20 bg-accent/8 shadow-sm' : 'hover:bg-fg/4 border-transparent'}`}
                  >
                    <div className="flex items-center gap-2 pr-6">
                      <AgentProviderLogo backend={s.backend} className="text-fg-muted h-4 w-4" />
                      <span className="text-fg min-w-0 flex-1 truncate text-[13px] font-medium">
                        {s.title}
                      </span>
                      {s.unread && (
                        <span
                          className="bg-accent h-1.5 w-1.5 rounded-full"
                          aria-label="Unread update"
                        />
                      )}
                    </div>
                    <p className="text-fg-dim truncate text-[11px]">
                      {s.project_name} ·{' '}
                      {s.backend_name || agentProviderNames[s.backend] || s.backend}
                      {s.isolated ? ' · worktree' : ''}
                    </p>
                    <AgentStatusBadge status={s.status} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${s.title}`}
                    title={
                      agentIsActive(s.status)
                        ? 'Stop the active turn before deleting'
                        : 'Delete conversation'
                    }
                    disabled={agentIsActive(s.status) || deletingId !== null}
                    onClick={() => setDeleteTarget(s)}
                    className="text-fg-dim hover:text-status-error hover:bg-status-error/10 focus-visible:ring-accent/40 absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg opacity-60 transition-colors group-hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
              {!filtered.length && (
                <p className="text-fg-dim px-3 py-8 text-center text-[12px]">
                  {ready ? 'No tasks in this view.' : 'Loading your workspace…'}
                </p>
              )}
            </div>
          )}
          {view === 'conversations' && (
            <div className="border-border text-fg-dim border-t px-4 py-3 text-[11px]">
              {project ? project.name : `${projects.length} projects`} · {all.length} sessions
            </div>
          )}
        </aside>
        {view === 'overview' && projects.length > 0 ? (
          <AgentMissionControl
            sessions={filtered}
            loading={!ready}
            archived={filter === 'archived'}
            canCreate={projects.length > 0}
            onSelect={openConversation}
            onNewTask={() => startTask()}
            onTemplate={startTask}
            onLane={
              filter === 'archived'
                ? undefined
                : (lane) => setFilter(lane === 'working' ? 'active' : lane)
            }
          />
        ) : view === 'conversations' && (creating || (!selected && projects.length > 0)) ? (
          <AgentNewSession
            key={template?.id ?? 'blank'}
            visible={visible}
            project={project}
            initialTemplate={template}
            onCreated={(s) => openConversation(s.id)}
            onClose={() => setCreating(false)}
          />
        ) : view === 'conversations' && selected ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-border flex justify-end border-b px-3">
              <button
                aria-label="Close conversation view"
                onClick={() => {
                  select(null);
                  setView('overview');
                }}
                className="text-fg-dim hover:text-fg p-1.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <AgentSessionView key={selected.id} session={selected} visible={visible} />
          </div>
        ) : (
          <div className="overlay-scroll flex flex-1 items-center justify-center overflow-auto p-8">
            <div className="max-w-lg text-center">
              <div className="bg-accent/10 text-accent mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
                <Bot className="h-7 w-7" />
              </div>
              <h2 className="text-fg text-xl font-semibold">
                {project
                  ? `Agent sessions for ${project.name}`
                  : 'Every project. Every agent. One workspace.'}
              </h2>
              <p className="text-fg-muted mt-3 text-[13px] leading-relaxed">
                Run your agent tools alongside your services. Follow their progress, answer
                questions and review changes without switching windows.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  disabled={!projects.length}
                  onClick={() => startTask()}
                  className="bg-accent text-surface rounded-md px-4 py-2 text-[13px] font-medium disabled:opacity-40"
                >
                  Start a task
                </button>
                {!project && (
                  <button
                    onClick={() => void addProject()}
                    className="border-border text-fg rounded-md border px-4 py-2 text-[13px]"
                  >
                    Add a project
                  </button>
                )}
              </div>
              {needsAttention > 0 && (
                <p className="text-accent mt-6 text-[12px]">
                  {needsAttention} task(s) are waiting for your response.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
