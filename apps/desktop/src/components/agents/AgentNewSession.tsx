import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FolderGit2,
  GitBranch,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  ListChecks,
} from 'lucide-react';
import {
  SearchableSelect,
  AgentComposer,
  AgentProviderChips,
  AgentConnectionStatus,
  AgentProviderPicker,
  AgentModelControls,
  AgentTaskSettings,
  AgentTaskTemplates,
  agentDetectionStatus,
  agentConnectionState,
  chooseAgentBackend,
  enabledAgentBackends,
} from '@runhq/cockpit-ui';
import type { AgentTaskTemplate } from '@runhq/cockpit-ui';
import type { AgentBackendId, AgentProject, AgentSession } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';

import { useAgentProjectOptions } from './useAgentProjectOptions';
import { useAgentCatalog } from './useAgentCatalog';
import { useAgentDiscovery } from './useAgentDiscovery';
import { createAgentTaskLauncher } from './agentTaskLauncher';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { AgentContextTray } from './AgentContextTray';
import { useAgentContext } from './useAgentContext';
import { agentContextImages, buildAgentContextPrompt, type AgentRecipe } from './agentLibraryModel';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { agentCapacityPreferences, agentOccupiedSlots } from './agentCapacity';
import {
  chooseAgentAccount,
  isPoolTarget,
  parseAccountCooldowns,
  describeRoutingNote,
  parseAccountPool,
  poolTarget,
  type AgentAccountPool,
} from './agentAccountRouting';
import { agentWorkspaceIpc } from '@/lib/ipc/agentWorkspaceIpc';
import { initialAgentTaskRecovery } from './agentSendRecovery';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function AgentNewSession({
  onClose,
  onCreated,
  project,
  visible = true,
  initialTemplate,
  initialRecipe,
  initialRouting,
}: {
  onClose: () => void;
  onCreated?: (session: AgentSession) => void;
  project?: AgentProject;
  visible?: boolean;
  initialTemplate?: AgentTaskTemplate;
  initialRecipe?: AgentRecipe;
  /** Why the opening account was chosen, when RunHQ rather than the user chose it. */
  initialRouting?: { poolName?: string; reason: string };
}) {
  i18n.useLocale();
  const storedProjects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const libraryRecords = useVisibleStore(useAgentLibraryStore, (s) => s.records, visible);
  const projects = project ? [project] : storedProjects;
  const projectOptions = useAgentProjectOptions(storedProjects, visible);
  const firstProjectId = projects[0]?.id ?? '';
  const filter = useVisibleStore(useAgentStore, (s) => s.projectFilter, visible);
  const [projectId, setProjectId] = useState(
    project?.id || initialRecipe?.projectId || filter || projects[0]?.id || '',
  );
  const draftKey = `new-task:${projectId}`;
  const context = useAgentContext(draftKey, projectId);
  const input = useVisibleStore(useAgentStore, (s) => s.drafts[draftKey] ?? '', visible);
  const setInput = (text: string) => useAgentStore.getState().setDraft(draftKey, text);
  const [backend, setBackend] = useState<AgentBackendId>('');
  // Set when RunHQ picked this account out of a pool, so the task can record why it ran where it
  // did. Cleared whenever the user names a connection themselves — that choice needs no reason.
  const [routedFrom, setRoutedFrom] = useState<{ poolName: string; reason: string } | null>(null);
  const userSelectedBackend = useRef(false);
  const backends = useVisibleStore(useAgentStore, (s) => s.tools, visible);
  const discovery = useAgentDiscovery(visible);
  const [executable, setExecutable] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [mode, setMode] = useState<'default' | 'plan'>('default');
  const [agent, setAgent] = useState('');
  const [title, setTitle] = useState('');
  const [isolated, setIsolated] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetLaunch, setForgetLaunch] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTaskTemplate['id']>();
  const [templateMode, setTemplateMode] = useState<'default' | 'plan' | null>(null);
  const templateApplied = useRef(false);
  const recipeApplied = useRef(false);
  const mounted = useRef(false);
  const launcher = useRef(
    createAgentTaskLauncher({
      create: (input, sourceSessionId) =>
        sourceSessionId
          ? agentWorkspaceIpc.handoffCreate(sourceSessionId, input)
          : ipc.agentCreate(input),
      start: ipc.agentStart,
      recovery: initialAgentTaskRecovery,
      created: (session, text) => {
        useAgentStore.getState().merge(session);
        useAgentStore.getState().setDraft(session.id, text);
      },
    }),
  );
  let restorationError: string | null = null;
  try {
    launcher.current.restore(projectId);
  } catch (error) {
    restorationError = String(error);
  }
  const recovered = launcher.current.recovery;
  const locked = busy || !!launcher.current.session || !!recovered || !!restorationError;
  const found = backends.find((entry) => entry.id === backend);
  const canDiscover =
    !!found &&
    found.enabled !== false &&
    found.adapter !== 'terminal' &&
    (!!executable.trim() || agentDetectionStatus(found) === 'available');
  const {
    catalog,
    loading,
    error: catalogError,
    refresh,
  } = useAgentCatalog(
    backend,
    executable,
    projectId,
    visible && !locked && canDiscover,
    undefined,
    model,
  );
  const connection = agentConnectionState({
    tool: found,
    discoveryReady: discovery.ready,
    discoveryError: discovery.error,
    executable,
    projectId,
    catalog,
    catalogError,
    model,
    availableAgents: enabledAgentBackends(backends).filter(
      (tool) => agentDetectionStatus(tool) === 'available',
    ).length,
  });
  const canSend =
    !busy &&
    !restorationError &&
    !!projectId &&
    (!!recovered ||
      (context.ready && (!!input.trim() || context.entries.length > 0) && connection.canStart));
  const accountPools = useMemo(() => {
    const parsed: AgentAccountPool[] = [];
    for (const [key, record] of Object.entries(libraryRecords)) {
      if (!key.startsWith('pool:')) continue;
      try {
        parsed.push(parseAccountPool(record.value));
      } catch {
        // An unreadable pool is not offered as a target rather than shown as an empty one.
      }
    }
    return parsed.sort((left, right) => left.name.localeCompare(right.name));
  }, [libraryRecords]);
  const poolOptions = accountPools.map((pool) => ({
    value: poolTarget(pool.id),
    label: pool.name,
    group: i18n.t('Account pools'),
    description: i18n.t('{value1} accounts · RunHQ picks a free one', {
      value1: pool.accounts.length,
    }),
  }));
  const selectBackend = (value: string) => {
    if (locked) return;
    userSelectedBackend.current = true;
    // A pool is a target, not a connection: resolve it now so the screen discovers that account's
    // models and modes, and so the identity the task will run as is visible before it starts.
    if (isPoolTarget(value)) {
      const pool = accountPools.find((entry) => poolTarget(entry.id) === value);
      const choice = pool
        ? chooseAgentAccount({
            pool,
            accounts: backends.map((tool) => ({
              id: tool.id,
              name: tool.name,
              adapter: tool.adapter ?? '',
              enabled: tool.enabled !== false,
              available: tool.available,
            })),
            need: { plan: mode === 'plan' },
            cooldowns: parseAccountCooldowns(libraryRecords['preferences:cooldowns']?.value),
            capacity: agentCapacityPreferences(libraryRecords['preferences:capacity']?.value),
            occupied: agentOccupiedSlots(
              useAgentStore.getState().sessions,
              useAgentQueueStore.getState().queues,
            ),
            now: Date.now(),
          })
        : null;
      if (!choice?.accountId) {
        setError(choice?.reason ?? i18n.t('That account pool was removed.'));
        return;
      }
      setRoutedFrom({ poolName: pool!.name, reason: choice.grounds });
      value = choice.accountId;
    } else setRoutedFrom(null);
    if (value === backend) return;
    setBackend(value);
    setTemplateMode(null);
    setMode('default');
    setExecutable('');
    setModel('');
    setEffort('');
    setAgent('');
    setError(null);
  };
  const recheck = () => {
    void discovery.refresh().then(refresh);
  };
  const applyTemplate = (template: AgentTaskTemplate) => {
    if (locked) return;
    setInput(template.prompt);
    setTitle(template.title);
    setSelectedTemplate(template.id);
    setTemplateMode(template.mode);
  };
  useEffect(() => {
    if (!initialTemplate || templateApplied.current || launcher.current.recovery) return;
    templateApplied.current = true;
    useAgentStore.getState().setDraft(draftKey, initialTemplate.prompt);
    setTitle(initialTemplate.title);
    setSelectedTemplate(initialTemplate.id);
    setTemplateMode(initialTemplate.mode);
  }, [draftKey, initialTemplate]);
  useEffect(() => {
    if (!initialRecipe || recipeApplied.current || launcher.current.recovery) return;
    recipeApplied.current = true;
    useAgentStore
      .getState()
      .setDraft(
        draftKey,
        initialRecipe.prompt +
          (initialRecipe.acceptance ? `\n\nAcceptance criteria:\n${initialRecipe.acceptance}` : ''),
      );
    setTitle(initialRecipe.name);
    if (initialRecipe.backend) {
      userSelectedBackend.current = true;
      setBackend(initialRecipe.backend);
    }
    setModel(initialRecipe.model);
    setEffort(initialRecipe.effort);
    setAgent(initialRecipe.agent);
    setIsolated(initialRecipe.isolated);
    setTemplateMode(initialRecipe.mode);
  }, [draftKey, initialRecipe]);
  useEffect(() => {
    if (templateMode === null || locked) return;
    // Wait for the selected provider's capabilities before enabling its plan mode.
    if (templateMode === 'plan' && !catalog) return;
    const planSupported = templateMode === 'plan' && catalog?.modes.includes('plan');
    setMode(planSupported ? 'plan' : 'default');
    setAgent('');
    setTemplateMode(null);
  }, [catalog, locked, templateMode]);
  useEffect(() => {
    if (!visible) return;
    const next = chooseAgentBackend({
      backends,
      current: backend,
      ready: discovery.ready,
      userSelected: userSelectedBackend.current,
      executable,
      locked,
    });
    if (next !== backend) {
      setBackend(next);
      setMode('default');
      setModel('');
      setEffort('');
      setAgent('');
      setExecutable('');
    }
  }, [backends, backend, discovery.ready, executable, locked, visible]);
  const currentProject = projects.find((entry) => entry.id === projectId);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!projectId && firstProjectId) setProjectId(firstProjectId);
  }, [firstProjectId, projectId]);
  useEffect(() => {
    const saved = launcher.current.recovery;
    if (!saved) return;
    userSelectedBackend.current = true;
    setBackend(saved.input.backend);
    setExecutable(saved.input.executable);
    setModel(saved.input.model);
    setEffort(saved.input.effort);
    setMode(saved.input.mode === 'plan' ? 'plan' : 'default');
    setAgent(saved.input.agent);
    setTitle(saved.input.title);
    setIsolated(saved.input.isolated);
  }, [projectId, recovered?.creationRequestId]);
  const openSession = (session: AgentSession) => {
    if (onCreated) onCreated(session);
    else useAgentStore.getState().select(session.id);
    onClose();
  };
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const saved = launcher.current.recovery;
      const draftText = saved?.draftText ?? input;
      const prompt = saved?.text ?? buildAgentContextPrompt(input, context.entries);
      const images = saved?.attachments ?? agentContextImages(context.entries);
      const sourceSessionId = saved?.sourceSessionId ?? initialRecipe?.sourceSessionId;
      const session = await launcher.current.send(
        saved?.input ?? {
          project_id: projectId,
          backend,
          executable,
          title: title.trim(),
          model,
          effort,
          mode,
          agent,
          isolated,
        },
        prompt,
        images,
        { sourceSessionId, draftText },
      );
      useAgentStore.getState().merge(session);
      const routing = routedFrom ?? initialRouting;
      if (routing)
        await useAgentLibraryStore.getState().save(`routing:${session.id}`, {
          accountId: session.backend,
          accountName:
            backends.find((tool) => tool.id === session.backend)?.name ?? session.backend,
          reason: routing.reason,
          ...(routing.poolName ? { poolName: routing.poolName } : {}),
          at: Date.now(),
        });
      if (sourceSessionId)
        await useAgentLibraryStore.getState().save(`link:${session.id}`, {
          sourceSessionId,
          targetSessionId: session.id,
          kind: 'handoff',
          createdAt: Date.now(),
        });
      if (
        context.ready &&
        buildAgentContextPrompt(draftText, context.entries) === prompt &&
        JSON.stringify(agentContextImages(context.entries)) === JSON.stringify(images)
      )
        await context.clear();
      // Another view may have edited either draft while this request was in flight.
      for (const key of [session.id, draftKey]) {
        if (useAgentStore.getState().drafts[key] === (key === session.id ? prompt : draftText))
          useAgentStore.getState().setDraft(key, '');
      }
      useAgentStore.getState().retryDraftPersistence();
      if (useAgentStore.getState().persistenceError)
        throw new Error(useAgentStore.getState().persistenceError!);
      launcher.current.complete();
      if (mounted.current) openSession(session);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      aria-label={i18n.t('New agent task')}
      className="overlay-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-5 py-8 lg:px-8"
    >
      {forgetLaunch && (
        <ConfirmDialog
          title={i18n.t('Forget this saved launch?')}
          message={i18n.t(
            'Any task or worktree already created will stay available. If creation was interrupted, review your existing tasks first. Forgetting this record lets you start a separate new task.',
          )}
          confirmLabel={i18n.t('Forget saved launch')}
          onCancel={() => setForgetLaunch(false)}
          onConfirm={() => {
            try {
              if (launcher.current.recovery) launcher.current.complete();
              else initialAgentTaskRecovery.save(null, projectId);
              setForgetLaunch(false);
              setError(null);
            } catch (error) {
              setError(String(error));
              setForgetLaunch(false);
            }
          }}
        />
      )}
      <div className="mx-auto my-auto w-full max-w-3xl py-6">
        <div className="mb-7 space-y-3">
          <div className="text-accent flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase">
            {i18n.rich('{value1} A new starting point', {
              value1: <Sparkles className="h-3.5 w-3.5" />,
            })}
          </div>
          <h2 className="text-fg text-[28px] leading-tight font-semibold tracking-tight">
            {i18n.t('What shall we build next?')}
          </h2>
          <p className="text-fg-muted text-[13px]">
            {i18n.t(
              'A clear plan, a careful fix, or your next big idea. Give your agent a place to start.',
            )}
          </p>
          <div className="pt-1">
            <AgentProviderChips
              backends={backends}
              selected={backend}
              selectedExecutable={connection.canStart ? executable.trim() : undefined}
              disabled={locked}
              onSelect={selectBackend}
            />
          </div>
        </div>
        {(recovered || restorationError) && (
          <div className="border-border bg-accent/5 text-fg-muted mb-4 space-y-2 rounded-xl border p-3 text-[12px]">
            <p>
              {restorationError ||
                (recovered?.phase === 'accepted'
                  ? i18n.t(
                      'Your first message was accepted. Continue to finish saving this task; the message will not be sent again.',
                    )
                  : i18n.t(
                      'A saved first message is waiting. Continue with its original workspace, model and context. A repeated request uses the same task and message IDs.',
                    ))}
            </p>
            {recovered && (
              <details>
                <summary className="cursor-pointer">{i18n.t('Review saved first message')}</summary>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] whitespace-pre-wrap">
                  {recovered.text}
                </pre>
              </details>
            )}
            <div className="flex gap-3">
              {launcher.current.session && (
                <button
                  type="button"
                  className="text-accent underline"
                  onClick={() => openSession(launcher.current.session!)}
                >
                  {i18n.t('Open existing task')}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                className="text-fg-dim underline"
                onClick={() => setForgetLaunch(true)}
              >
                {i18n.t('Forget saved launch')}
              </button>
            </div>
          </div>
        )}
        {!launcher.current.session && !recovered && !restorationError && (
          <AgentConnectionStatus
            state={connection}
            refreshing={discovery.loading || loading}
            disabled={locked}
            onRecheck={recheck}
            onRetryCatalog={refresh}
            onSettings={() => setAdvanced(true)}
            onManage={() => useAgentStore.setState({ toolsOpen: true })}
            onUseDefaultModel={() => {
              setModel('');
              setEffort('');
              setError(null);
            }}
          />
        )}
        {(routedFrom ?? initialRouting) && (
          <p className="text-fg-muted mb-3 text-[11px]">
            {i18n.rich(
              '{value1}. Change the agent above to override it; the task keeps whichever account it starts on.',
              {
                value1: describeRoutingNote({
                  accountId: backend,
                  accountName: backends.find((tool) => tool.id === backend)?.name ?? backend,
                  reason: (routedFrom ?? initialRouting)!.reason,
                  ...((routedFrom ?? initialRouting)!.poolName
                    ? { poolName: (routedFrom ?? initialRouting)!.poolName }
                    : {}),
                  at: Date.now(),
                }),
              },
            )}
          </p>
        )}
        <div className="text-fg-dim mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
          {project ? (
            <span className="truncate" title={project.path}>
              {project.name}
            </span>
          ) : (
            <SearchableSelect
              label={i18n.t('Project')}
              indentGrouped
              value={projectId}
              disabled={locked}
              compact
              placeholder={i18n.t('Add a project to start')}
              className="max-w-64"
              options={projectOptions}
              searchPlaceholder={i18n.t('Find a project or group…')}
              onChange={(value) => {
                if (initialRecipe?.sourceSessionId) return;
                setProjectId(value);
                setAgent('');
              }}
            />
          )}
          <span className="bg-border mx-1 h-3 w-px" />
          <button
            type="button"
            disabled={locked || !!initialRecipe?.sourceSessionId}
            onClick={() => setIsolated(!isolated)}
            aria-pressed={isolated}
            title={
              isolated
                ? i18n.t(
                    'New worktree from committed HEAD; local changes and dependencies are not copied.',
                  )
                : i18n.t('Work in this project’s current directory')
            }
            className="hover:text-fg flex min-w-0 items-center gap-1.5 disabled:opacity-40"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            {initialRecipe?.sourceSessionId
              ? i18n.t('Source task workspace')
              : isolated
                ? i18n.t('Isolated worktree')
                : i18n.t('Local workspace')}
          </button>
        </div>
        <AgentComposer
          value={recovered?.draftText ?? input}
          onChange={setInput}
          onSend={() => void send()}
          busy={busy}
          disabled={locked}
          placeholder={i18n.t('Ask your agent to build, fix, or explore…')}
          controls={
            <>
              <AgentProviderPicker
                value={backend}
                backends={backends}
                disabled={locked}
                loading={discovery.loading}
                onChange={selectBackend}
                extraOptions={poolOptions}
              />
              {canDiscover && catalog && (
                <AgentModelControls
                  catalog={catalog}
                  loading={loading}
                  refresh={refresh}
                  model={model}
                  effort={effort}
                  agent={agent}
                  onAgent={(value) => {
                    setTemplateMode(null);
                    setAgent(value);
                    if ((found?.adapter || backend) === 'opencode' && value)
                      setMode(value === 'plan' ? 'plan' : 'default');
                  }}
                  mode={mode}
                  disabled={locked}
                  onModel={(value) => {
                    setModel(value);
                    setEffort('');
                  }}
                  onEffort={setEffort}
                  onMode={(value) => {
                    setTemplateMode(null);
                    setMode(value);
                    setAgent('');
                  }}
                />
              )}
              <button
                type="button"
                aria-label={i18n.t('Task settings')}
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
                className={`hover:bg-fg/5 rounded-lg p-2 ${advanced ? 'bg-fg/5 text-fg' : 'text-fg-dim'}`}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </>
          }
          action={
            <button
              type="button"
              aria-label={
                recovered
                  ? i18n.t('Continue saved first message')
                  : launcher.current.session
                    ? i18n.t('Retry first message')
                    : i18n.t('Send message')
              }
              title={
                canSend
                  ? i18n.t('Send · ⌘ / Ctrl + Enter')
                  : !connection.canStart && !launcher.current.session
                    ? connection.title
                    : i18n.t('Write a message to start')
              }
              onClick={() => void send()}
              disabled={!canSend}
              className="bg-fg text-surface hover:bg-fg/85 disabled:bg-fg/8 disabled:text-fg-dim flex h-8 w-8 items-center justify-center rounded-xl shadow-sm transition-colors disabled:shadow-none"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          }
        >
          <AgentContextTray
            draftKey={draftKey}
            projectId={projectId}
            adapter={found?.adapter || backend}
            disabled={locked}
          />
          {initialRecipe && (initialRecipe.setupCommands || initialRecipe.checkCommands) && (
            <p className="text-fg-dim px-4 pb-3 text-[11px]">
              {i18n.t(
                'This recipe includes setup/check commands. Launch it from Library → Create workflow to run and record those steps.',
              )}
            </p>
          )}
          {advanced && (
            <AgentTaskSettings
              title={title}
              onTitle={setTitle}
              executable={executable}
              onExecutable={(value) => {
                userSelectedBackend.current = true;
                setExecutable(value);
                setError(null);
                setModel('');
                setEffort('');
                setAgent('');
              }}
              isolated={isolated}
              onIsolated={(value) => {
                if (!initialRecipe?.sourceSessionId) setIsolated(value);
              }}
              backend={backend}
              detected={found}
              connectionError={executable.trim() ? catalogError : undefined}
              checkingConnection={loading}
              projectPath={currentProject?.path}
              commands={catalog?.commands ?? []}
              disabled={locked}
              onClose={() => setAdvanced(false)}
            />
          )}
        </AgentComposer>
        <div className="text-fg-dim mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span>{i18n.t('⌘ / Ctrl + Enter to send')}</span>
          <span>
            {busy
              ? i18n.t('Starting your task…')
              : i18n.t('Session starts with your first message')}
          </span>
        </div>
        {mode === 'plan' && (
          <p className="text-cat-backend mt-3 flex items-center gap-1.5 text-[11px]">
            {i18n.rich(
              '{value1}Plan mode · Explore the project and agree on an approach before implementation.',
              { value1: <ListChecks className="h-3.5 w-3.5 shrink-0" /> },
            )}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="border-status-error/20 bg-status-error/5 text-status-error mt-4 rounded-lg border p-3 text-[12px] break-words"
          >
            <p>{error}</p>
            {launcher.current.session && (
              <p className="mt-2">
                {i18n.rich('Your session and message are saved. Retry sending, or {value1}.', {
                  value1: (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => openSession(launcher.current.session!)}
                    >
                      {i18n.t('open the conversation')}
                    </button>
                  ),
                })}
              </p>
            )}
          </div>
        )}
        <div className="border-border/70 mt-7 border-t pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg-muted text-[11px] font-medium">
              {i18n.t('Start with a direction')}
            </h3>
            <span className="text-fg-dim text-[10px]">
              {i18n.t('Adds a prompt you can edit before sending')}
            </span>
          </div>
          <AgentTaskTemplates
            onSelect={applyTemplate}
            selected={selectedTemplate}
            disabled={locked}
          />
        </div>
      </div>
    </section>
  );
}
