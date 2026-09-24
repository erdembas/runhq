import { WorkspaceOverview } from '@/components/workspaces/WorkspaceOverview';
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
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { openAgentTask, openWorkflow } from '@/lib/workbenchNavigation';
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
import { AgentTaskPane } from '@/components/workbench/AgentTaskPane';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { AgentDecisionInbox } from './AgentDecisionInbox';
import { AgentRecoveryNotice } from './AgentRecoveryNotice';
import { recipeStepsToCreateSteps } from './agentWorkflowRecipeBridge';
import { AgentWorkflowHub, type AgentWorkflowRecipe } from './AgentWorkflowHub';
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

type AgentWorkspaceView =
  'overview' | 'conversations' | 'inbox' | 'workflows' | 'library' | 'usage';
type WorkflowHost = { scope: string; recipe?: AgentWorkflowRecipe; recipeId?: string };

export function AgentWorkspace({
  visible,
  project,
  shell = false,
}: {
  visible: boolean;
  project?: AgentProject;
  shell?: boolean;
}) {
  i18n.useLocale();
  const globalShell = shell && !project;
  const projectShell = shell && !!project;
  const sessionsId = useId();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const maxSessionsWidth = workspaceWidth ? Math.min(480, Math.floor(workspaceWidth * 0.45)) : 480;
  const minSessionsWidth = Math.min(200, maxSessionsWidth);
  const [storedSessionsCollapsed, setSessionsCollapsed] = usePersistentBoolean(
    'runhq.agent-session-list-collapsed',
    false,
  );
  // Project conversations always expose their history when the Agents tab opens.
  const sessionsCollapsed = !projectShell && storedSessionsCollapsed;
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
  // Only the global host observes navigation while hidden. A project host owns its selection and
  // must neither subscribe to nor replay navigation from another project or the global workspace.
  const globalSelectedId = useVisibleStore(useAgentStore, (s) => s.selectedId, !project);
  const navigationRevision = useVisibleStore(useAgentStore, (s) => s.navigationRevision, !project);
  const projectSelectedId = useVisibleStore(
    useWorkbenchStore,
    (state) => (project ? (state.projectSelectedSessions[project.id] ?? null) : null),
    visible && !!project,
  );
  const projectSelectionRevision = useVisibleStore(
    useWorkbenchStore,
    (state) => (project ? (state.projectSelectionRevisions[project.id] ?? 0) : 0),
    visible && !!project,
  );
  const selectedId = project ? projectSelectedId : globalSelectedId;
  const select = (id: string | null) => {
    if (project) useWorkbenchStore.getState().setProjectSelectedSession(project.id, id);
    else useAgentStore.getState().select(id);
  };
  const globalProjectFilter = useVisibleStore(
    useAgentStore,
    (s) => s.projectFilter,
    visible && !project,
  );
  const projectFilter = project?.id ?? globalProjectFilter;
  const scopedWorkspace = projects.find((entry) => entry.id === projectFilter && entry.workspace);
  const ready = useVisibleStore(useAgentStore, (s) => s.ready, visible);
  const storeError = useVisibleStore(useAgentStore, (s) => s.error, visible);
  const [creating, setCreating] = useState(false);
  const [legacyView, setLegacyView] = useState<AgentWorkspaceView>(
    projectShell || selectedId ? 'conversations' : 'overview',
  );
  const shellView = useVisibleStore(
    useWorkbenchStore,
    (state) => state.agentView,
    globalShell && visible,
  );
  const shellViewRevision = useVisibleStore(
    useWorkbenchStore,
    (state) => state.agentViewRevision,
    globalShell && visible,
  );
  const requestedWorkflowId = useVisibleStore(
    useWorkbenchStore,
    (state) => state.requestedWorkflowId,
    globalShell && visible,
  );
  const pendingHandoff = useVisibleStore(
    useWorkbenchStore,
    (state) => state.agentHandoff,
    globalShell && visible,
  );
  const view = projectShell ? 'conversations' : globalShell ? shellView : legacyView;
  const setView = (next: AgentWorkspaceView) => {
    if (globalShell) useWorkbenchStore.getState().requestAgentView(next);
    else setLegacyView(next);
  };
  // Each visited scope owns its draft and selection. Hiding a section must not recreate its editor.
  const [workflowHosts, setWorkflowHosts] = useState<WorkflowHost[]>([]);
  const [libraryScopes, setLibraryScopes] = useState<string[]>([]);
  const [localWorkflowRequest, setLocalWorkflowRequest] = useState<string | null>(null);
  useEffect(() => {
    if (view === 'workflows')
      setWorkflowHosts((hosts) =>
        hosts.some((host) => host.scope === projectFilter)
          ? hosts
          : [...hosts, { scope: projectFilter }],
      );
    if (view === 'library')
      setLibraryScopes((scopes) =>
        scopes.includes(projectFilter) ? scopes : [...scopes, projectFilter],
      );
  }, [view, projectFilter]);
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
  // Why the composer opens on the account it does, when RunHQ chose it rather than the user.
  const [routing, setRouting] = useState<{ poolName?: string; reason: string } | undefined>();
  const [focusItemId, setFocusItemId] = useState<string>();
  const observedNavigation = useRef(navigationRevision);
  useEffect(() => {
    const changed = observedNavigation.current !== navigationRevision;
    observedNavigation.current = navigationRevision;
    if (project || !globalSelectedId) return;
    if (globalShell) {
      // Hidden workflow hosts must not consume session navigation meant for a project.
      if (visible && changed) {
        useWorkbenchStore.getState().requestAgentView('conversations');
        setCreating(false);
      }
    } else {
      setLegacyView('conversations');
      setCreating(false);
    }
  }, [globalSelectedId, navigationRevision, project, globalShell, visible]);
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
            (!projectShell && Number(b.pending.length > 0) - Number(a.pending.length > 0)) ||
            b.updated_at - a.updated_at,
        ),
    [sessions, projectFilter, projectShell, filter, search],
  );
  const candidate = selectedId ? sessions[selectedId] : null;
  const selected =
    candidate && (!projectFilter || candidate.project_id === projectFilter) ? candidate : null;
  useEffect(() => {
    if (!projectShell || !visible || creating || selected || !ready || !project) return;
    const latest = Object.values(sessions)
      .filter((session) => session.project_id === project.id && !session.archived)
      .sort((a, b) => b.updated_at - a.updated_at)[0];
    if (latest) useWorkbenchStore.getState().setProjectSelectedSession(project.id, latest.id);
  }, [projectShell, visible, creating, selected, ready, project, sessions]);
  const [conversationHosts, setConversationHosts] = useState<string[]>([]);
  useEffect(() => {
    if (!shell || !visible || view !== 'conversations' || !selected) return;
    setConversationHosts((hosts) =>
      hosts.includes(selected.id) ? hosts : [...hosts, selected.id],
    );
  }, [shell, visible, view, selected]);
  const observedProjectSelection = useRef(projectSelectionRevision);
  useEffect(() => {
    if (!visible || !project) return;
    if (observedProjectSelection.current !== projectSelectionRevision) setCreating(false);
    observedProjectSelection.current = projectSelectionRevision;
  }, [projectSelectionRevision, visible, project]);
  const startTask = (nextTemplate?: AgentTaskTemplate) => {
    setRecipe(undefined);
    // A blank task is the user's own choice of agent, so no routing reason applies to it.
    setRouting(undefined);
    setTemplate(nextTemplate);
    setCreating(true);
    setView('conversations');
  };
  const openConversation = (id: string, itemId?: string) => {
    if (shell) {
      setCreating(false);
      openAgentTask(id, { focusItemId: itemId });
      return;
    }
    setFocusItemId(itemId);
    select(id);
    setCreating(false);
    setView('conversations');
  };
  const openWorkflowSession = (id: string, workflowId?: string) => {
    if (shell) openAgentTask(id, { workflowId });
    else openConversation(id);
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
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;
  useEffect(() => {
    if (!globalShell || !visible || !pendingHandoff) return;
    const source = useAgentStore.getState().sessions[pendingHandoff.sessionId];
    if (!source) return;
    handoffRef.current(source, pendingHandoff.items);
    useWorkbenchStore.setState({ agentHandoff: null });
  }, [globalShell, visible, pendingHandoff]);
  const startWorkflowRecipe = (next: AgentRecipe) => {
    const scope = project?.id || next.projectId || projectFilter;
    if (!project && scope !== projectFilter) useAgentStore.setState({ projectFilter: scope });
    const recipe: AgentWorkflowRecipe = {
      title: next.name,
      prompt: next.prompt,
      backend: composerAccount(next),
      model: next.model,
      effort: next.effort,
      setupCommands: next.setupCommands.split('\n').filter(Boolean),
      checkCommands: next.checkCommands.split('\n').filter(Boolean),
      acceptance: next.acceptance,
      steps: next.workflowSteps
        ? recipeStepsToCreateSteps(next.workflowSteps, (target) =>
            composerAccountForTarget({
              target,
              pool: routingPool,
              accounts: routingAccounts(),
              cooldowns: routingCooldowns(),
              capacity: agentCapacityPreferences(
                useAgentLibraryStore.getState().records['preferences:capacity']?.value,
              ),
              occupied: routingOccupancy(),
              now: Date.now(),
            }),
          )
        : undefined,
    };
    // Choosing a new recipe intentionally starts a new editor in this scope. Visiting another
    // section or project, in contrast, keeps every existing editor mounted.
    setWorkflowHosts((hosts) => [
      ...hosts.filter((host) => host.scope !== scope),
      { scope, recipe, recipeId: crypto.randomUUID() },
    ]);
    if (globalShell) useWorkbenchStore.setState({ requestedWorkflowId: null });
    else setLocalWorkflowRequest(null);
    setView('workflows');
  };
  const showWorkflow = (id: string, projectId: string) => {
    if (globalShell) openWorkflow(id, projectId);
    else {
      setLocalWorkflowRequest(id);
      setView('workflows');
    }
  };
  const deleteConversation = async (id: string) => {
    setDeleteTarget(null);
    setDeletingId(id);
    setError(null);
    try {
      await useAgentStore.getState().deleteSession(id);
      if (selectedId === id) select(null);
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
  const shellTaskList = globalShell && view === 'conversations' && !creating && !selected;
  const showComposer =
    view === 'conversations' &&
    (creating || ((!shell || projectShell) && !selected && projects.length > 0 && ready));
  const composerVisited = useRef(false);
  if (showComposer) composerVisited.current = true;
  const sectionTitle = {
    overview: scopedWorkspace
      ? i18n.t('Workspace overview')
      : projectShell
        ? i18n.t('Agents')
        : shell
          ? i18n.t('Tasks')
          : i18n.t('Overview'),
    conversations: projectShell ? i18n.t('Agents') : i18n.t('Tasks'),
    inbox: i18n.t('Needs attention'),
    workflows: i18n.t('Workflows'),
    library: i18n.t('Library'),
    usage: i18n.t('Capacity & usage'),
  }[view];
  return (
    <div className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col">
      {deleteTarget && visible && (
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
      {!projectShell && (
        <header
          className={`border-border/70 flex shrink-0 flex-wrap items-center gap-1.5 border-b ${shell ? 'px-5 py-3' : 'px-3 py-1.5'}`}
        >
          {shell ? (
            <>
              <h1 className="text-fg mr-3 text-[16px] font-semibold">{sectionTitle}</h1>
              {!project && (
                <SearchableSelect
                  label={i18n.t('Filter by project')}
                  indentGrouped
                  compact
                  value={projectFilter}
                  options={[{ value: '', label: i18n.t('All projects') }, ...projectOptions]}
                  onChange={(value) =>
                    useAgentStore.setState({ projectFilter: value, selectedId: null })
                  }
                  searchPlaceholder={i18n.t('Find a project or group…')}
                  className="w-56 max-w-full"
                />
              )}
            </>
          ) : !project ? (
            <h1 className="text-fg mr-2 text-[13px] font-semibold">{i18n.t('Agents')}</h1>
          ) : null}
          {view === 'conversations' && !shellTaskList && (
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
          {!shell && (
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
          )}
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
                setView(projectShell ? 'conversations' : 'inbox');
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
            {shell && ['overview', 'conversations'].includes(view) && !creating && (
              <div
                role="group"
                aria-label={i18n.t('Task view')}
                className="border-border mr-2 flex rounded-lg border p-0.5"
              >
                {(
                  [
                    {
                      value: 'overview',
                      label: scopedWorkspace ? i18n.t('Overview') : i18n.t('Board'),
                      icon: LayoutDashboard,
                    },
                    { value: 'conversations', label: i18n.t('List'), icon: MessagesSquare },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => setView(value)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${view === value ? 'bg-fg/7 text-fg' : 'text-fg-muted hover:text-fg'}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!shell && (
              <button
                title={i18n.t('Agent tools')}
                aria-label={i18n.t('Agent tools')}
                onClick={() => useAgentStore.setState({ toolsOpen: true })}
                className="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
              >
                <Wrench className="h-3.5 w-3.5" />
              </button>
            )}
            {!project && (!shell || ['overview', 'conversations'].includes(view)) && (
              <button
                aria-label={i18n.t('Add project')}
                title={i18n.t('Add project')}
                onClick={() => void addProject()}
                className="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-md p-1.5"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            )}
            {(!shell || ['overview', 'conversations'].includes(view)) && (
              <button
                disabled={!projects.length}
                onClick={() => startTask()}
                className="border-border text-fg hover:bg-fg/5 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
              >
                {i18n.rich('{value1}New task', { value1: <Plus className="h-3.5 w-3.5" /> })}
              </button>
            )}
            {!shell && view === 'conversations' && selected && !creating && (
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
      )}
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
      {!project && visible && <AgentRecoveryNotice onOpenSession={openConversation} />}
      {!project && <AgentUsageNotifications visible={visible} onOpenSession={openConversation} />}
      <div
        ref={workspaceRef}
        className={`flex min-h-0 min-w-0 flex-1 ${view === 'overview' ? 'flex-col' : ''}`}
      >
        <aside
          id={sessionsId}
          className={`border-border bg-surface relative min-w-0 shrink-0 flex-col ${(scopedWorkspace && view === 'overview') || !['overview', 'conversations'].includes(view) || (view === 'conversations' && sessionsCollapsed && !shellTaskList) ? 'hidden' : 'flex'} ${view === 'overview' ? 'border-b' : shellTaskList ? 'flex-1' : 'border-r'}`}
          style={
            view === 'conversations'
              ? shellTaskList
                ? { width: '100%' }
                : { width: sessionsWidth.width, maxWidth: '45%' }
              : undefined
          }
          aria-label={projectShell ? i18n.t('Chat history') : i18n.t('Project agent sessions')}
        >
          {projectShell && (
            <div className="border-border/60 flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
              <h2 className="text-fg-muted text-[12px] font-medium">{i18n.t('Chat history')}</h2>
              <button
                type="button"
                onClick={() => startTask()}
                className="border-border text-fg hover:bg-fg/5 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
              >
                <Plus className="h-3 w-3" aria-hidden />
                {i18n.t('New task')}
              </button>
            </div>
          )}
          <div
            className={
              view === 'overview' || shellTaskList
                ? 'flex flex-wrap items-center gap-3 px-5 py-3'
                : 'border-border/60 space-y-3 border-b p-3'
            }
          >
            {!project && !shell && (
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
                onChange={(value) =>
                  useAgentStore.setState({ projectFilter: value, selectedId: null })
                }
                searchPlaceholder={i18n.t('Find a project or group…')}
                className={view === 'overview' ? 'w-56 max-w-full' : 'w-full'}
              />
            )}
            <div
              className={`bg-surface border-border flex min-w-0 items-center gap-2 rounded-lg border px-2.5 ${view === 'overview' || shellTaskList ? 'w-72 max-w-full' : ''}`}
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
              className={view === 'overview' || shellTaskList ? 'w-36' : 'w-full'}
            />
          </div>
          {view === 'conversations' && (
            <div
              className={`overlay-scroll flex-1 overflow-auto ${shellTaskList ? 'space-y-2 p-5' : 'p-2'}`}
            >
              {filtered.map((s) => (
                <div
                  key={s.id}
                  className={`group relative ${shellTaskList ? 'border-border rounded-xl border' : 'mb-1.5'}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      openConversation(s.id);
                    }}
                    aria-current={selectedId === s.id && !creating ? 'true' : undefined}
                    className={`w-full rounded-md text-left transition-colors ${shellTaskList ? `grid items-center gap-3 p-3 pr-10 ${projectShell ? 'md:grid-cols-[minmax(0,1fr)_12rem]' : 'md:grid-cols-[minmax(0,1fr)_10rem_12rem]'}` : 'space-y-1.5 p-2.5'} ${selectedId === s.id && !creating ? 'bg-fg/7' : 'hover:bg-fg/4'}`}
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
                    {!projectShell && (
                      <p
                        className="text-fg-muted flex min-w-0 items-center gap-1.5 text-[11px] font-medium"
                        title={s.project_name}
                      >
                        <FolderGit2 className="text-accent/80 h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{s.project_name}</span>
                      </p>
                    )}
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
          {view === 'conversations' && !sessionsCollapsed && !shellTaskList && (
            <ResizeHandle
              handleProps={sessionResizeProps}
              dragging={sessionsWidth.dragging}
              className="focus-visible:bg-accent/15 absolute inset-y-0 -right-1 w-2 touch-none focus-visible:outline-none"
              title={i18n.t('Resize conversation list · drag or use ←/→ · double-click to reset')}
            />
          )}
        </aside>
        {composerVisited.current && (
          <div
            hidden={!showComposer}
            className={showComposer ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
          >
            <AgentNewSession
              key={`${projectFilter}:${recipe?.id ?? template?.id ?? 'blank'}`}
              visible={visible && showComposer}
              project={project}
              initialTemplate={template}
              initialRecipe={recipe}
              initialRouting={routing}
              onCreated={(s) => openConversation(s.id)}
              onClose={() => setCreating(false)}
            />
          </div>
        )}
        {shell &&
          conversationHosts.map((id) => {
            const session = sessions[id];
            if (!session || (project && session.project_id !== project.id)) return null;
            const active = view === 'conversations' && selected?.id === id && !creating;
            return (
              <div
                key={id}
                hidden={!active}
                className={active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
              >
                <AgentTaskPane
                  sessionId={id}
                  visible={visible && active}
                  onHandoff={(items) => handoff(session, items)}
                />
              </div>
            );
          })}
        {workflowHosts.map((host) => {
          const active = view === 'workflows' && host.scope === projectFilter;
          return (
            <div
              key={`${host.scope}:${host.recipeId || 'workflow'}`}
              hidden={!active}
              className={active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
            >
              <AgentWorkflowHub
                shell={shell}
                visible={visible && active}
                projectId={host.scope || undefined}
                onOpenSession={openWorkflowSession}
                initialRecipe={host.recipe}
                requestedWorkflowId={
                  active ? (globalShell ? requestedWorkflowId : localWorkflowRequest) : null
                }
                requestRevision={globalShell ? shellViewRevision : 0}
                onWorkflowRequestHandled={() => {
                  if (globalShell) useWorkbenchStore.setState({ requestedWorkflowId: null });
                  else setLocalWorkflowRequest(null);
                }}
              />
            </div>
          );
        })}
        {libraryScopes.map((scope) => {
          const active = view === 'library' && scope === projectFilter;
          return (
            <div
              key={scope}
              hidden={!active}
              className={active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
            >
              <AgentLibrary
                shell={shell}
                visible={visible && active}
                projectId={scope || undefined}
                onOpenSession={openConversation}
                onRecipe={startRecipe}
                onWorkflow={startWorkflowRecipe}
              />
            </div>
          );
        })}
        {showComposer ||
        view === 'workflows' ||
        view === 'library' ||
        shellTaskList ||
        (shell && view === 'conversations' && selected && !creating) ? null : view === 'inbox' ? (
          <AgentDecisionInbox
            visible={visible}
            projectId={projectFilter || undefined}
            onOpenSession={openConversation}
            onOpenWorkflow={showWorkflow}
            shell={shell}
          />
        ) : view === 'usage' ? (
          <AgentUsagePanel visible={visible} projectId={projectFilter || undefined} />
        ) : view === 'overview' && scopedWorkspace ? (
          <WorkspaceOverview
            key={scopedWorkspace.id}
            project={scopedWorkspace}
            sessions={scoped}
            visible={visible}
            onNewTask={() => startTask()}
          />
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
        ) : projectShell && !ready && !creating ? (
          <div className="text-fg-muted flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 text-[13px]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {i18n.t('Loading your workspace…')}
          </div>
        ) : view === 'conversations' && selected && !shell ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AgentSessionView
              key={selected.id}
              session={selected}
              visible={visible}
              focusItemId={focusItemId}
              onHandoff={(items) => handoff(selected, items)}
              onOpenSession={openConversation}
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
