import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Bot,
  Wrench,
  CircleHelp,
  FolderPlus,
  FolderGit2,
  Plus,
  Search,
  Trash2,
  Loader2,
  LayoutDashboard,
  MessagesSquare,
  PanelLeft,
  X,
  Inbox,
  GitPullRequest,
  BookOpen,
  ChartNoAxesCombined,
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
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { agentCapacityPreferences, agentOccupiedSlots } from './agentCapacity';
import {
  composerAccountForTarget,
  isPoolTarget,
  handoffAccountAfterLimit,
  parseAccountCooldowns,
  parseAccountPool,
  type AgentAccountPool,
} from './agentAccountRouting';
import { useAgentProjectOptions } from './useAgentProjectOptions';
import { AgentNewSession } from './AgentNewSession';
import { AgentSessionView } from './AgentSessionView';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { AgentDecisionInbox } from './AgentDecisionInbox';
import { AgentRecoveryNotice } from './AgentRecoveryNotice';
import { recipeStepsToCreateSteps } from './agentWorkflowRecipeBridge';
import { AgentWorkflowHub } from './AgentWorkflowHub';
import { AgentLibrary } from './AgentLibrary';
import { AgentUsagePanel } from './AgentUsagePanel';
import { AgentUsageNotifications } from './AgentUsageNotifications';
import type { AgentRecipe } from './agentLibraryModel';
import type { AgentItem } from '@runhq/cockpit-types';

const AGENT_TASK_FILTERS = [
  {
    value: 'all',
    get label() {
      return i18n.t('All tasks');
    },
  },
  {
    value: 'attention',
    get label() {
      return i18n.t('Needs attention');
    },
  },
  {
    value: 'active',
    get label() {
      return i18n.t('Working');
    },
  },
  {
    value: 'ready',
    get label() {
      return i18n.t('Ready');
    },
  },
  {
    value: 'completed',
    get label() {
      return i18n.t('Completed');
    },
  },
  {
    value: 'archived',
    get label() {
      return i18n.t('Archived');
    },
  },
];

export function AgentWorkspace({ visible, project }: { visible: boolean; project?: AgentProject }) {
  i18n.useLocale();
  const sessionsId = useId();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const maxSessionsWidth = workspaceWidth ? Math.min(480, Math.floor(workspaceWidth * 0.45)) : 480;
  const minSessionsWidth = Math.min(200, maxSessionsWidth);
  const [sessionsCollapsed, setSessionsCollapsed] = usePersistentBoolean(
    'runhq.agent-session-list-collapsed',
    false,
  );
  const sessionsWidth = useResizableWidth({
    storageKey: 'runhq.agent-session-list.width',
    defaultWidth: 260,
    min: minSessionsWidth,
    max: maxSessionsWidth,
  });
  const sessionResizeProps = {
    ...sessionsWidth.handleProps,
    'aria-label': i18n.t('Resize conversation list'),
    'aria-controls': sessionsId,
    'aria-valuemin': minSessionsWidth,
    'aria-valuemax': maxSessionsWidth,
    'aria-valuenow': sessionsWidth.width,
  };
  const storedProjects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const projects = project ? [project] : storedProjects;
  const projectOptions = useAgentProjectOptions(storedProjects, visible);
  const sessions = useVisibleStore(useAgentStore, (s) => s.sessions, visible);
  const globalSelectedId = useVisibleStore(useAgentStore, (s) => s.selectedId, visible);
  const navigationRevision = useVisibleStore(useAgentStore, (s) => s.navigationRevision, visible);
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
  const [view, setView] = useState<
    'overview' | 'conversations' | 'inbox' | 'workflows' | 'library' | 'usage'
  >(selectedId ? 'conversations' : 'overview');
  useEffect(() => {
    if (!visible || view !== 'conversations') return;
    const element = workspaceRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setWorkspaceWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, view]);
  const [template, setTemplate] = useState<AgentTaskTemplate | undefined>();
  const [recipe, setRecipe] = useState<AgentRecipe | undefined>();
  const [workflowRecipe, setWorkflowRecipe] = useState<AgentRecipe | undefined>();
  // Why the composer opens on the account it does, when RunHQ chose it rather than the user.
  const [routing, setRouting] = useState<{ poolName?: string; reason: string } | undefined>();
  const [focusItemId, setFocusItemId] = useState<string>();
  useEffect(() => {
    if (!project && globalSelectedId) {
      setView('conversations');
      setCreating(false);
    }
  }, [globalSelectedId, navigationRevision, project]);
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
    setRecipe(undefined);
    // A blank task is the user's own choice of agent, so no routing reason applies to it.
    setRouting(undefined);
    setTemplate(nextTemplate);
    setCreating(true);
    setView('conversations');
  };
  const openConversation = (id: string, itemId?: string) => {
    setFocusItemId(itemId);
    select(id);
    setCreating(false);
    setView('conversations');
  };
  const startRecipe = (next: AgentRecipe) => {
    // The composer works in connections and discovers one account's models and modes, so a recipe
    // that targets a pool is resolved to the account it would start on before the draft opens.
    const backend = composerAccount(next);
    const pool = isPoolTarget(next.backend)
      ? routingPool(next.backend.slice('pool:'.length))
      : null;
    setRouting(
      backend && pool
        ? { poolName: pool.name, reason: i18n.t('had a free execution slot') }
        : undefined,
    );
    setRecipe(backend === next.backend ? next : { ...next, backend });
    setTemplate(undefined);
    setCreating(true);
    setView('conversations');
  };
  const routingPool = (id: string) => {
    const saved = useAgentLibraryStore.getState().records[`pool:${id}`];
    try {
      return saved ? parseAccountPool(saved.value) : null;
    } catch {
      return null;
    }
  };
  const routingAccounts = () =>
    useAgentStore.getState().tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      adapter: tool.adapter ?? '',
      enabled: tool.enabled !== false,
      available: tool.available,
    }));
  const routingCooldowns = () =>
    parseAccountCooldowns(useAgentLibraryStore.getState().records['preferences:cooldowns']?.value);
  const routingOccupancy = () =>
    agentOccupiedSlots(useAgentStore.getState().sessions, useAgentQueueStore.getState().queues);
  const composerAccount = (recipe: AgentRecipe) =>
    composerAccountForTarget({
      target: recipe.backend,
      pool: routingPool,
      accounts: routingAccounts(),
      need: { plan: recipe.mode === 'plan' },
      cooldowns: routingCooldowns(),
      capacity: agentCapacityPreferences(
        useAgentLibraryStore.getState().records['preferences:capacity']?.value,
      ),
      occupied: routingOccupancy(),
      now: Date.now(),
    });
  /**
   * A session keeps the account that opened it, so a limit is taken over by a new session. When the
   * source account is on cool-down and grouped with others, the composer opens on the account
   * routing would pick; otherwise the agent is left unset for the user to choose, as before.
   */
  const handoffAccount = (source: AgentSession) => {
    const library = useAgentLibraryStore.getState();
    const pools: AgentAccountPool[] = [];
    for (const key of Object.keys(library.records)) {
      if (!key.startsWith('pool:')) continue;
      const pool = routingPool(key.slice('pool:'.length));
      // An unreadable pool cannot be routed through and is simply not offered.
      if (pool) pools.push(pool);
    }
    return handoffAccountAfterLimit({
      sourceAccountId: source.backend,
      pools,
      accounts: routingAccounts(),
      cooldowns: routingCooldowns(),
      capacity: agentCapacityPreferences(library.records['preferences:capacity']?.value),
      occupied: routingOccupancy(),
      now: Date.now(),
    });
  };
  const handoff = (source: AgentSession, items: AgentItem[]) => {
    const account = handoffAccount(source);
    const taken = account
      ? {
          reason: i18n.t('takes over after {value1} reported a limit', {
            value1: source.backend_name || source.backend,
          }),
        }
      : undefined;
    startRecipe({
      id: crypto.randomUUID(),
      name: i18n.t('Follow up · {value1}', { value1: source.title }),
      sourceSessionId: source.id,
      projectId: source.project_id,
      prompt: `Continue the work described below in a new agent session. Inspect the current files before making changes.\n\nSource task: ${source.title}\nWorkspace: ${source.cwd}\nBranch: ${source.branch || 'local checkout'}\n\nRecent conversation:\n${items
        .filter((item) => ['user', 'assistant', 'plan'].includes(item.kind))
        .slice(-6)
        .map((item) => `${item.kind}: ${item.text}`)
        .join('\n\n')
        .slice(-60000)}\n\nNext objective: `,
      backend: account,
      model: '',
      effort: '',
      mode: 'default',
      agent: '',
      isolated: false,
      acceptance: '',
      setupCommands: '',
      checkCommands: '',
      version: 1,
    });
    if (taken) setRouting(taken);
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
      const path = await open({
        directory: true,
        multiple: false,
        title: i18n.t('Add an agent project'),
      });
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
          title={i18n.t('Delete conversation?')}
          message={i18n.t(
            '“{value1}” and its message history will be permanently removed from RunHQ. Project files, Git worktrees and the agent tool’s own history will be kept.',
            { value1: deleteTarget.title },
          )}
          confirmLabel={i18n.t('Delete conversation')}
          onConfirm={() => void deleteConversation(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <header className="border-border/70 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        {!project && <h1 className="text-fg mr-2 text-[13px] font-semibold">{i18n.t('Agents')}</h1>}
        {view === 'conversations' && (
          <button
            type="button"
            aria-label={sessionsCollapsed ? i18n.t('Show task list') : i18n.t('Hide task list')}
            title={sessionsCollapsed ? i18n.t('Show task list') : i18n.t('Hide task list')}
            aria-expanded={!sessionsCollapsed}
            aria-controls={sessionsId}
            onClick={() => setSessionsCollapsed((value) => !value)}
            className="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label={i18n.t('Agent workspace view')}
        >
          {(
            [
              { value: 'overview', label: i18n.t('Overview'), icon: LayoutDashboard },
              { value: 'conversations', label: i18n.t('Conversations'), icon: MessagesSquare },
              { value: 'inbox', label: i18n.t('Inbox'), icon: Inbox },
              { value: 'workflows', label: i18n.t('Workflows'), icon: GitPullRequest },
              { value: 'library', label: i18n.t('Library'), icon: BookOpen },
              { value: 'usage', label: i18n.t('Usage'), icon: ChartNoAxesCombined },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ${view === value ? 'bg-fg/7 text-fg font-medium' : 'text-fg-dim hover:text-fg hover:bg-fg/3'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {working > 0 && (
          <span className="text-fg-dim ml-2 text-[11px]">
            {i18n.rich('{working} working', { working: working })}
          </span>
        )}
        {needsAttention > 0 && (
          <button
            onClick={() => {
              setFilter('attention');
              select(null);
              setCreating(false);
              setView('inbox');
            }}
            className="text-accent flex items-center gap-1 text-[12px]"
          >
            {i18n.rich('{value1}{needsAttention} need you', {
              value1: <CircleHelp className="h-3.5 w-3.5" />,
              needsAttention: needsAttention,
            })}
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            title={i18n.t('Agent tools')}
            aria-label={i18n.t('Agent tools')}
            onClick={() => useAgentStore.setState({ toolsOpen: true })}
            className="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
          >
            <Wrench className="h-3.5 w-3.5" />
          </button>
          {!project && (
            <button
              aria-label={i18n.t('Add project')}
              title={i18n.t('Add project')}
              onClick={() => void addProject()}
              className="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            disabled={!projects.length}
            onClick={() => startTask()}
            className="border-border text-fg hover:bg-fg/5 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            {i18n.rich('{value1}New task', { value1: <Plus className="h-3.5 w-3.5" /> })}
          </button>
          {view === 'conversations' && selected && !creating && (
            <button
              type="button"
              aria-label={i18n.t('Close conversation view')}
              title={i18n.t('Close conversation view')}
              onClick={() => {
                select(null);
                setView('overview');
              }}
              className="text-fg-dim hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>
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
            {i18n.t('Retry')}
          </button>
        </div>
      )}
      <AgentRecoveryNotice onOpenSession={openConversation} />
      <AgentUsageNotifications visible={visible} onOpenSession={openConversation} />
      <div
        ref={workspaceRef}
        className={`flex min-h-0 min-w-0 flex-1 ${view === 'overview' ? 'flex-col' : ''}`}
      >
        <aside
          id={sessionsId}
          className={`border-border bg-surface relative min-w-0 shrink-0 flex-col ${!['overview', 'conversations'].includes(view) || (view === 'conversations' && sessionsCollapsed) ? 'hidden' : 'flex'} ${view === 'overview' ? 'border-b' : 'border-r'}`}
          style={
            view === 'conversations' ? { width: sessionsWidth.width, maxWidth: '45%' } : undefined
          }
          aria-label={i18n.t('Project agent sessions')}
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
                label={i18n.t('Filter by project')}
                indentGrouped
                value={projectFilter}
                options={[
                  {
                    value: '',
                    label: i18n.t('All projects'),
                    description: i18n.t('{value1} projects in your workspace', {
                      value1: projects.length,
                    }),
                  },
                  ...projectOptions,
                ]}
                onChange={(value) => useAgentStore.setState({ projectFilter: value })}
                searchPlaceholder={i18n.t('Find a project or group…')}
                className={view === 'overview' ? 'w-56 max-w-full' : 'w-full'}
              />
            )}
            <div
              className={`bg-surface border-border flex min-w-0 items-center gap-2 rounded-lg border px-2.5 ${view === 'overview' ? 'w-60 max-w-full' : ''}`}
            >
              <Search className="text-fg-dim h-3.5 w-3.5" />
              <input
                aria-label={i18n.t('Search agent sessions')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={i18n.t('Search tasks…')}
                className="text-fg w-full bg-transparent py-2 text-[12px] outline-none"
              />
            </div>
            <SearchableSelect
              label={i18n.t('Filter tasks by status')}
              searchable={false}
              compact
              menuWidth={200}
              value={filter}
              options={AGENT_TASK_FILTERS}
              onChange={(value) => setFilter(value as typeof filter)}
              className={view === 'overview' ? 'w-36' : 'w-full'}
            />
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
                    aria-current={selectedId === s.id && !creating ? 'true' : undefined}
                    className={`w-full space-y-1.5 rounded-md p-2.5 text-left transition-colors ${selectedId === s.id && !creating ? 'bg-fg/7' : 'hover:bg-fg/4'}`}
                  >
                    <div className="flex items-center gap-2 pr-6">
                      <AgentProviderLogo
                        backend={s.backend}
                        className="text-fg-muted h-4 w-4 shrink-0"
                      />
                      <span
                        className="text-fg min-w-0 flex-1 truncate text-[13px] font-medium"
                        title={s.title}
                      >
                        {s.title}
                      </span>
                      {s.unread && (
                        <span
                          className="bg-accent h-1.5 w-1.5 rounded-full"
                          aria-label={i18n.t('Unread update')}
                        />
                      )}
                    </div>
                    <p
                      className="text-fg-muted flex min-w-0 items-center gap-1.5 text-[11px] font-medium"
                      title={s.project_name}
                    >
                      <FolderGit2 className="text-accent/80 h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{s.project_name}</span>
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <AgentStatusBadge status={s.status} />
                      <span className="text-fg-dim min-w-0 truncate text-[10px]">
                        {s.backend_name || agentProviderNames[s.backend] || s.backend}
                        {s.isolated ? i18n.t(' · worktree') : ''}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={i18n.t('Delete conversation: {value1}', { value1: s.title })}
                    title={
                      agentIsActive(s.status)
                        ? i18n.t('Stop the active turn before deleting')
                        : i18n.t('Delete conversation')
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
                  {ready ? i18n.t('No tasks in this view.') : i18n.t('Loading your workspace…')}
                </p>
              )}
            </div>
          )}
          {view === 'conversations' && (
            <div className="border-border/60 text-fg-dim border-t px-3 py-2 text-[11px]">
              {i18n.rich('{value1} · {value2} sessions', {
                value1: project
                  ? project.name
                  : i18n.t('{value1} projects', { value1: projects.length }),
                value2: all.length,
              })}
            </div>
          )}
          {view === 'conversations' && !sessionsCollapsed && (
            <ResizeHandle
              handleProps={sessionResizeProps}
              dragging={sessionsWidth.dragging}
              className="focus-visible:bg-accent/15 absolute inset-y-0 -right-1 w-2 touch-none focus-visible:outline-none"
              title={i18n.t('Resize conversation list · drag or use ←/→ · double-click to reset')}
            />
          )}
        </aside>
        {view === 'inbox' ? (
          <AgentDecisionInbox
            visible={visible}
            projectId={projectFilter || undefined}
            onOpenSession={openConversation}
          />
        ) : view === 'workflows' ? (
          <AgentWorkflowHub
            key={`${projectFilter || 'all'}:${workflowRecipe?.id || 'workflow'}`}
            visible={visible}
            projectId={projectFilter || undefined}
            onOpenSession={openConversation}
            initialRecipe={
              workflowRecipe
                ? {
                    title: workflowRecipe.name,
                    prompt: workflowRecipe.prompt,
                    backend: workflowRecipe.backend,
                    model: workflowRecipe.model,
                    effort: workflowRecipe.effort,
                    setupCommands: workflowRecipe.setupCommands.split('\n').filter(Boolean),
                    checkCommands: workflowRecipe.checkCommands.split('\n').filter(Boolean),
                    acceptance: workflowRecipe.acceptance,
                    steps: workflowRecipe.workflowSteps
                      ? recipeStepsToCreateSteps(workflowRecipe.workflowSteps, (target) =>
                          // A recipe may name a pool; the form resolves it to an account on open.
                          composerAccountForTarget({
                            target,
                            pool: routingPool,
                            accounts: routingAccounts(),
                            cooldowns: routingCooldowns(),
                            capacity: agentCapacityPreferences(
                              useAgentLibraryStore.getState().records['preferences:capacity']
                                ?.value,
                            ),
                            occupied: routingOccupancy(),
                            now: Date.now(),
                          }),
                        )
                      : undefined,
                  }
                : undefined
            }
          />
        ) : view === 'library' ? (
          <AgentLibrary
            projectId={projectFilter || undefined}
            onOpenSession={openConversation}
            onRecipe={startRecipe}
            onWorkflow={(next) => {
              if (!project && next.projectId)
                useAgentStore.setState({ projectFilter: next.projectId });
              // A workflow step also runs as one connection, so a pool target resolves here too.
              setWorkflowRecipe({ ...next, backend: composerAccount(next) });
              setView('workflows');
            }}
          />
        ) : view === 'usage' ? (
          <AgentUsagePanel visible={visible} projectId={projectFilter || undefined} />
        ) : view === 'overview' && projects.length > 0 ? (
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
            key={recipe?.id ?? template?.id ?? 'blank'}
            visible={visible}
            project={project}
            initialTemplate={template}
            initialRecipe={recipe}
            initialRouting={routing}
            onCreated={(s) => openConversation(s.id)}
            onClose={() => setCreating(false)}
          />
        ) : view === 'conversations' && selected ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AgentSessionView
              key={selected.id}
              session={selected}
              visible={visible}
              focusItemId={focusItemId}
              onHandoff={(items) => handoff(selected, items)}
            />
          </div>
        ) : (
          <div className="overlay-scroll flex flex-1 items-center justify-center overflow-auto p-8">
            <div className="max-w-lg text-center">
              <div className="bg-accent/10 text-accent mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
                <Bot className="h-7 w-7" />
              </div>
              <h2 className="text-fg text-xl font-semibold">
                {project
                  ? i18n.t('Agent sessions for {value1}', { value1: project.name })
                  : i18n.t('Every project. Every agent. One workspace.')}
              </h2>
              <p className="text-fg-muted mt-3 text-[13px] leading-relaxed">
                {i18n.t(
                  'Run your agent tools alongside your services. Follow their progress, answer questions and review changes without switching windows.',
                )}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  disabled={!projects.length}
                  onClick={() => startTask()}
                  className="bg-accent text-surface rounded-md px-4 py-2 text-[13px] font-medium disabled:opacity-40"
                >
                  {i18n.t('Start a task')}
                </button>
                {!project && (
                  <button
                    onClick={() => void addProject()}
                    className="border-border text-fg rounded-md border px-4 py-2 text-[13px]"
                  >
                    {i18n.t('Add a project')}
                  </button>
                )}
              </div>
              {needsAttention > 0 && (
                <p className="text-accent mt-6 text-[12px]">
                  {i18n.rich('{needsAttention} task(s) are waiting for your response.', {
                    needsAttention: needsAttention,
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
