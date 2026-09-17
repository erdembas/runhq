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

export function AgentNewSession({
  onClose,
  onCreated,
  project,
  visible = true,
  initialTemplate,
}: {
  onClose: () => void;
  onCreated?: (session: AgentSession) => void;
  project?: AgentProject;
  visible?: boolean;
  initialTemplate?: AgentTaskTemplate;
}) {
  const storedProjects = useVisibleStore(useAgentStore, (s) => s.projects, visible);
  const projects = project ? [project] : storedProjects;
  const projectOptions = useAgentProjectOptions(storedProjects, visible);
  const firstProjectId = projects[0]?.id ?? '';
  const filter = useVisibleStore(useAgentStore, (s) => s.projectFilter, visible);
  const [projectId, setProjectId] = useState(project?.id || filter || projects[0]?.id || '');
  const draftKey = `new-task:${projectId}`;
  const input = useVisibleStore(useAgentStore, (s) => s.drafts[draftKey] ?? '', visible);
  const setInput = (text: string) => useAgentStore.getState().setDraft(draftKey, text);
  const [backend, setBackend] = useState<AgentBackendId>('');
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
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTaskTemplate['id']>();
  const [templateMode, setTemplateMode] = useState<'default' | 'plan' | null>(null);
  const templateApplied = useRef(false);
  const mounted = useRef(false);
  const launcher = useRef(
    createAgentTaskLauncher({
      create: ipc.agentCreate,
      start: ipc.agentStart,
      created: (session, text) => {
        useAgentStore.getState().merge(session);
        useAgentStore.getState().setDraft(session.id, text);
      },
    }),
  );
  const locked = busy || !!launcher.current.session;
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
    !busy && !!projectId && !!input.trim() && (!!launcher.current.session || connection.canStart);
  const selectBackend = (value: string) => {
    if (locked) return;
    userSelectedBackend.current = true;
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
    if (!initialTemplate || templateApplied.current) return;
    templateApplied.current = true;
    useAgentStore.getState().setDraft(draftKey, initialTemplate.prompt);
    setTitle(initialTemplate.title);
    setSelectedTemplate(initialTemplate.id);
    setTemplateMode(initialTemplate.mode);
  }, [draftKey, initialTemplate]);
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
      const session = await launcher.current.send(
        {
          project_id: projectId,
          backend,
          executable,
          title: title.trim() || input.trim().split('\n')[0]?.slice(0, 80) || 'New task',
          model,
          effort,
          mode,
          agent,
          isolated,
        },
        input,
      );
      useAgentStore.getState().merge(session);
      // Another view may have edited either draft while this request was in flight.
      for (const key of [session.id, draftKey]) {
        if (useAgentStore.getState().drafts[key] === input)
          useAgentStore.getState().setDraft(key, '');
      }
      if (mounted.current) openSession(session);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      aria-label="New agent task"
      className="overlay-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-5 py-8 lg:px-8"
    >
      <div className="mx-auto my-auto w-full max-w-3xl py-6">
        <div className="mb-7 space-y-3">
          <div className="text-accent flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase">
            <Sparkles className="h-3.5 w-3.5" /> A new starting point
          </div>
          <h2 className="text-fg text-[28px] leading-tight font-semibold tracking-tight">
            What shall we build next?
          </h2>
          <p className="text-fg-muted text-[13px]">
            A clear plan, a careful fix, or your next big idea. Give your agent a place to start.
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
        {!launcher.current.session && (
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
        <div className="text-fg-dim mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
          {project ? (
            <span className="truncate" title={project.path}>
              {project.name}
            </span>
          ) : (
            <SearchableSelect
              label="Project"
              indentGrouped
              value={projectId}
              disabled={locked}
              compact
              placeholder="Add a project to start"
              className="max-w-64"
              options={projectOptions}
              searchPlaceholder="Find a project or group…"
              onChange={(value) => {
                setProjectId(value);
                setAgent('');
              }}
            />
          )}
          <span className="bg-border mx-1 h-3 w-px" />
          <button
            type="button"
            disabled={locked}
            onClick={() => setIsolated(!isolated)}
            aria-pressed={isolated}
            title={
              isolated
                ? 'New worktree from committed HEAD; local changes and dependencies are not copied.'
                : 'Work in this project’s current directory'
            }
            className="hover:text-fg flex min-w-0 items-center gap-1.5 disabled:opacity-40"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            {isolated ? 'Isolated worktree' : 'Local workspace'}
          </button>
        </div>
        <AgentComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          busy={busy}
          disabled={!!launcher.current.session}
          placeholder="Ask your agent to build, fix, or explore…"
          controls={
            <>
              <AgentProviderPicker
                value={backend}
                backends={backends}
                disabled={locked}
                loading={discovery.loading}
                onChange={selectBackend}
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
                aria-label="Task settings"
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
              aria-label={launcher.current.session ? 'Retry first message' : 'Send message'}
              title={
                canSend
                  ? 'Send · ⌘ / Ctrl + Enter'
                  : !connection.canStart && !launcher.current.session
                    ? connection.title
                    : 'Write a message to start'
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
              onIsolated={setIsolated}
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
          <span>⌘ / Ctrl + Enter to send</span>
          <span>{busy ? 'Starting your task…' : 'Session starts with your first message'}</span>
        </div>
        {mode === 'plan' && (
          <p className="text-cat-backend mt-3 flex items-center gap-1.5 text-[11px]">
            <ListChecks className="h-3.5 w-3.5 shrink-0" />
            Plan mode · Explore the project and agree on an approach before implementation.
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
                Your session and message are saved. Retry sending, or{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => openSession(launcher.current.session!)}
                >
                  open the conversation
                </button>
                .
              </p>
            )}
          </div>
        )}
        <div className="border-border/70 mt-7 border-t pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg-muted text-[11px] font-medium">Start with a direction</h3>
            <span className="text-fg-dim text-[10px]">
              Adds a prompt you can edit before sending
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
