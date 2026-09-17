import { Fragment, memo, useEffect, useRef, useState, type ElementRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Bot,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import type { AgentBackend, AgentTool } from '@runhq/cockpit-types';
import {
  AgentDiscoverySummary,
  AgentProviderLogo,
  AgentToolDetectionBadge,
  AgentToolDetectionDetails,
  SearchableSelect,
  agentDetectionStatus,
  agentIsActive,
} from '@runhq/cockpit-ui';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { TerminalPane } from '@/components/TerminalPane';
import { useAgentProjectOptions } from './useAgentProjectOptions';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentDiscovery } from './useAgentDiscovery';

const field =
  'border-fg/10 bg-fg/3 text-fg focus:border-fg/25 w-full rounded-xl border px-3 py-2 text-[12px]';
const detectionOrder = { available: 0, blocked: 1, not_found: 2 };
const detectionLabels = { available: 'Installed', blocked: 'Setup required', not_found: 'Missing' };
const configuration = (tool: AgentBackend): AgentTool => ({
  id: tool.id,
  name: tool.name,
  adapter: tool.adapter || 'acp',
  executable: tool.command || tool.executable || tool.id,
  args: tool.args ?? [],
  enabled: tool.enabled !== false,
});
export const AgentToolsHub = memo(function AgentToolsHub() {
  const open = useAgentStore((s) => s.toolsOpen);
  const discovery = useAgentDiscovery(open);
  const tools = useVisibleStore(useAgentStore, (s) => s.tools, open);
  const projects = useVisibleStore(useAgentStore, (s) => s.projects, open);
  const runningByTool = useVisibleStore(
    useAgentStore,
    useShallow((s) => {
      const counts: Record<string, number> = {};
      for (const session of Object.values(s.sessions)) {
        if (agentIsActive(session.status))
          counts[session.backend] = (counts[session.backend] ?? 0) + 1;
      }
      return counts;
    }),
    open,
  );
  const projectOptions = useAgentProjectOptions(projects, open);
  const [projectId, setProjectId] = useState('');
  const project =
    projects.find((p) => p.id === (projectId || useAgentStore.getState().projectFilter)) ||
    projects[0];
  const [query, setQuery] = useState(''),
    [edit, setEdit] = useState<AgentTool | null>(null),
    [args, setArgs] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<
      { id: string; toolId: string; name: string; cwd: string; projectName: string }[]
    >([]),
    [selectedTerminal, setSelectedTerminal] = useState<string | null>(null);
  const dialog = useRef<ElementRef<'dialog'>>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async (tool: AgentTool) => {
    await ipc.agentSaveTool(tool);
    await useAgentStore.getState().refreshTools(true);
  };
  const filtered = tools
    .filter((t) =>
      `${t.name} ${t.adapter} ${t.command} ${t.executable || ''} ${t.version || ''} ${detectionLabels[agentDetectionStatus(t)]}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) => detectionOrder[agentDetectionStatus(a)] - detectionOrder[agentDetectionStatus(b)],
    );
  const beginEdit = (tool: AgentTool) => {
    setEdit(tool);
    setArgs(tool.args.join('\n'));
    setNotice(null);
    setError(null);
  };
  const stop = async (toolId: string) => {
    const targets = Object.values(useAgentStore.getState().sessions).filter(
      (s) => s.backend === toolId && agentIsActive(s.status),
    );
    const outcomes = await Promise.allSettled(targets.map((s) => ipc.agentInterrupt(s.id)));
    setTerminals((current) => current.filter((t) => t.toolId !== toolId));
    const failed = outcomes.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  };
  return (
    <dialog
      ref={dialog}
      aria-label="Agent tools"
      onCancel={(event) => {
        event.preventDefault();
        if (!document.activeElement?.closest('[data-agent-terminal]'))
          useAgentStore.setState({ toolsOpen: false });
      }}
      className="bg-surface text-fg border-fg/10 fixed m-auto h-[min(820px,90vh)] w-[min(1100px,94vw)] max-w-none overflow-hidden rounded-2xl border p-0 shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-fg/8 flex items-center gap-3 border-b px-5 py-4">
          <span className="bg-fg/5 rounded-xl p-2">
            <Wrench className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Agent tools</h2>
            <p className="text-fg-dim mt-0.5 text-[11px]">
              Local agents, connections and terminal sessions
            </p>
          </div>
          <span className="flex-1" />
          <button
            aria-label="Refresh tool detection"
            disabled={discovery.loading}
            onClick={() => void discovery.refresh()}
            className="text-fg-muted hover:bg-fg/5 flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${discovery.loading ? 'animate-spin' : ''}`} />
            {discovery.loading ? 'Checking…' : 'Re-scan'}
          </button>
          <button
            aria-label="Close agent tools"
            onClick={() => useAgentStore.setState({ toolsOpen: false })}
            className="hover:bg-fg/5 rounded-lg p-2"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {(error || notice) && (
          <p
            role={error ? 'alert' : 'status'}
            className={`border-fg/8 border-b px-5 py-3 text-[12px] ${error ? 'text-status-error' : 'text-fg-muted'}`}
          >
            {error || notice}
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          <section className="border-fg/8 flex w-[44%] min-w-72 flex-col border-r">
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                <label className="bg-fg/4 flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3">
                  <Search className="text-fg-dim h-3.5 w-3.5" />
                  <input
                    aria-label="Search agent tools"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a tool…"
                    style={{ outline: 'none' }}
                    className="min-w-0 bg-transparent py-2 text-[12px]"
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    beginEdit({
                      id: `tool-${crypto.randomUUID()}`,
                      name: '',
                      adapter: 'acp',
                      executable: '',
                      args: [],
                      enabled: true,
                    })
                  }
                  className="bg-fg text-surface flex items-center gap-1.5 rounded-xl px-3 text-[12px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add tool
                </button>
              </div>
              <AgentDiscoverySummary
                tools={tools}
                loading={discovery.loading}
                ready={discovery.ready}
                error={discovery.error}
                checkedAt={discovery.checkedAt}
              />
            </div>
            <div className="overlay-scroll min-h-0 flex-1 space-y-2 overflow-auto px-4 pb-4">
              {filtered.map((tool, index) => {
                const status = agentDetectionStatus(tool);
                const startGroup =
                  index === 0 || agentDetectionStatus(filtered[index - 1]!) !== status;
                const running = runningByTool[tool.id] ?? 0;
                const terminalCount = terminals.filter((t) => t.toolId === tool.id).length;
                return (
                  <Fragment key={tool.id}>
                    {startGroup && (
                      <h3 className="text-fg-dim flex items-center gap-2 px-1 pt-3 pb-1 text-[10px] font-medium first:pt-0">
                        {detectionLabels[status]}
                        <span className="border-fg/8 flex-1 border-t" />
                      </h3>
                    )}
                    <article
                      className={`border-fg/8 rounded-xl border p-3 ${tool.enabled === false ? 'opacity-60' : 'bg-fg/2'}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="bg-fg/5 rounded-lg p-2">
                          <AgentProviderLogo backend={tool.id} className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h4 className="truncate text-[13px] font-medium">{tool.name}</h4>
                            <AgentToolDetectionBadge tool={tool} />
                          </div>
                          <p className="text-fg-dim mt-0.5 text-[10px]">
                            {tool.adapter === 'terminal'
                              ? 'Terminal interface'
                              : tool.adapter === 'acp'
                                ? 'ACP connection'
                                : 'Native integration'}
                            {tool.enabled === false && ' · Disabled'}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`Enable ${tool.name}`}
                          aria-checked={tool.enabled !== false}
                          disabled={busy}
                          onClick={() =>
                            void action(() =>
                              save({ ...configuration(tool), enabled: tool.enabled === false }),
                            )
                          }
                          className={`w-8 shrink-0 rounded-full p-0.5 transition-colors ${tool.enabled !== false ? 'bg-fg/75' : 'bg-fg/15'}`}
                        >
                          <span
                            className={`bg-surface block h-3.5 w-3.5 rounded-full transition-transform ${tool.enabled !== false ? 'translate-x-3.5' : ''}`}
                          />
                        </button>
                      </div>
                      {tool.id === 'cursor' && (
                        <p className="text-fg-dim mt-2 text-[10px] leading-relaxed">
                          Agent, Plan and Ask through the installed CLI's ACP connection.
                        </p>
                      )}
                      <AgentToolDetectionDetails tool={tool} />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          disabled={busy}
                          onClick={() => beginEdit(configuration(tool))}
                          className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px]"
                        >
                          Configure
                        </button>
                        {tool.adapter === 'terminal' ? (
                          <button
                            disabled={
                              busy ||
                              !tool.available ||
                              tool.enabled === false ||
                              !project ||
                              terminals.length >= 8
                            }
                            onClick={() => {
                              if (!project) return;
                              const id = `agent-tool-${crypto.randomUUID()}`;
                              setTerminals((current) => [
                                ...current,
                                {
                                  id,
                                  toolId: tool.id,
                                  name: tool.name,
                                  cwd: project.path,
                                  projectName: project.name,
                                },
                              ]);
                              setSelectedTerminal(id);
                              setEdit(null);
                            }}
                            className="bg-fg/5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
                          >
                            <Terminal className="h-3 w-3" />
                            Open terminal
                          </button>
                        ) : (
                          <button
                            disabled={busy || tool.enabled === false || !tool.available || !project}
                            onClick={() =>
                              void action(async () => {
                                if (!project) return;
                                const catalog = await ipc.agentCatalog(tool.id, '', project.id);
                                setNotice(
                                  `${tool.name}: connected · ${catalog.models.length} models${catalog.connection === 'acp' ? `${catalog.agents.length ? ` · modes: ${catalog.agents.join(', ')}` : ''}${catalog.can_resume ? ' · session resume supported' : ' · session resume not advertised'}` : ''}`,
                                );
                              })
                            }
                            className="bg-fg/5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
                          >
                            <Check className="h-3 w-3" />
                            Test connection
                          </button>
                        )}
                        {tool.adapter !== 'terminal' && tool.adapter !== 'acp' && (
                          <button
                            disabled={
                              busy ||
                              !tool.available ||
                              tool.enabled === false ||
                              !project ||
                              terminals.length >= 8
                            }
                            onClick={() => {
                              if (!project) return;
                              const id = `agent-tool-${crypto.randomUUID()}`;
                              setTerminals((current) => [
                                ...current,
                                {
                                  id,
                                  toolId: tool.id,
                                  name: tool.name,
                                  cwd: project.path,
                                  projectName: project.name,
                                },
                              ]);
                              setSelectedTerminal(id);
                              setEdit(null);
                            }}
                            className="bg-fg/5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
                          >
                            <Terminal className="h-3 w-3" />
                            Open CLI
                          </button>
                        )}
                        {(running > 0 || terminalCount > 0) && (
                          <button
                            disabled={busy}
                            onClick={() => void action(() => stop(tool.id))}
                            className="text-status-error flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
                          >
                            <Square className="h-3 w-3" />
                            Stop ({running + terminalCount})
                          </button>
                        )}
                      </div>
                      <p className="text-fg-dim mt-2 text-[10px]">
                        {running} working · {terminalCount} terminals open
                      </p>
                    </article>
                  </Fragment>
                );
              })}
              {!filtered.length && (
                <p className="text-fg-dim py-8 text-center text-[12px]">
                  {discovery.loading && !tools.length
                    ? 'Looking for your agent tools…'
                    : discovery.error && !tools.length
                      ? 'Re-scan to load your local agent tools.'
                      : query.trim()
                        ? 'No tools match your search.'
                        : discovery.ready
                          ? 'No tools are configured. Add an agent tool to get started.'
                          : 'Agent detection is starting…'}
                </p>
              )}
            </div>
            <p className="border-fg/8 text-fg-dim border-t px-4 py-3 text-[10px] leading-relaxed">
              Disabling a tool prevents new starts. Existing sessions and terminals keep running.
            </p>
          </section>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="border-fg/8 flex items-center gap-2 border-b p-3">
              <span className="text-fg-dim text-[11px]">Project</span>
              <SearchableSelect
                label="Tool project"
                value={project?.id || ''}
                onChange={setProjectId}
                options={projectOptions}
                indentGrouped
                compact
                className="min-w-0 flex-1"
              />
            </div>
            {edit ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await save({
                      ...edit,
                      args:
                        edit.adapter === 'acp' || edit.adapter === 'terminal'
                          ? args.split('\n').filter(Boolean)
                          : [],
                    });
                    setEdit(null);
                    setNotice('Tool saved. New sessions use this configuration.');
                  });
                }}
                className="overlay-scroll min-h-0 flex-1 space-y-4 overflow-auto p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-medium">
                    {tools.some((t) => t.id === edit.id) ? 'Configure tool' : 'Add an agent tool'}
                  </h3>
                  <button
                    type="button"
                    aria-label="Close tool configuration"
                    onClick={() => setEdit(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <label className="block text-[11px]">
                  Name
                  <input
                    required
                    maxLength={200}
                    className={`${field} mt-1.5`}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <label className="block text-[11px]">
                  Connection
                  <div className="mt-1.5">
                    <SearchableSelect
                      label="Tool connection"
                      value={edit.adapter}
                      onChange={(value) =>
                        setEdit({ ...edit, adapter: value as AgentTool['adapter'] })
                      }
                      disabled={['codex', 'opencode', 'claude', 'cursor'].includes(edit.id)}
                      options={[
                        {
                          value: 'acp',
                          label: 'ACP · Integrated conversation',
                          description: 'Messages, permissions and agent-advertised models / modes',
                        },
                        {
                          value: 'terminal',
                          label: 'Terminal · Any interactive CLI',
                          description:
                            'Use the tool’s own model, login, question and permission UI',
                        },
                        ...['codex', 'opencode', 'claude'].map((value) => ({
                          value,
                          label: `${value} · Native adapter`,
                        })),
                      ]}
                      className="w-full"
                    />
                  </div>
                </label>
                <label className="block text-[11px]">
                  Executable
                  <input
                    required
                    className={`${field} mt-1.5`}
                    value={edit.executable}
                    onChange={(e) => setEdit({ ...edit, executable: e.target.value })}
                    placeholder="Executable name on PATH or absolute path"
                  />
                </label>
                {(edit.adapter === 'acp' || edit.adapter === 'terminal') && (
                  <label className="block text-[11px]">
                    Arguments · one per line
                    <textarea
                      rows={3}
                      className={`${field} mt-1.5 resize-y font-mono`}
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="Each line is passed as one argument"
                    />
                  </label>
                )}
                <p className="text-fg-dim text-[11px] leading-relaxed">
                  {edit.adapter === 'acp'
                    ? 'Use an installed ACP-compatible executable and the arguments documented by that tool. Capabilities and authentication depend on the agent.'
                    : edit.adapter === 'terminal'
                      ? 'Terminal tools run directly in the selected project. Their interactive prompts and controls stay in the embedded terminal.'
                      : 'Choose a compatible installed CLI for this native integration.'}{' '}
                  Arguments are passed directly, without shell expansion.
                </p>
                <button
                  disabled={busy}
                  className="bg-fg text-surface flex items-center gap-2 rounded-xl px-4 py-2 text-[12px]"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save tool
                </button>
              </form>
            ) : null}
            <div className={`flex min-h-0 flex-1 flex-col ${edit ? 'hidden' : ''}`}>
              {!!terminals.length && (
                <div className="border-fg/8 flex flex-wrap gap-1 border-b p-2">
                  {terminals.map((t) => (
                    <div
                      key={t.id}
                      className={`flex max-w-full items-center rounded-lg text-[11px] ${selectedTerminal === t.id ? 'bg-fg/7' : 'hover:bg-fg/4'}`}
                    >
                      <button
                        onClick={() => setSelectedTerminal(t.id)}
                        className="truncate px-2 py-1.5"
                      >
                        {t.name} · {t.projectName}
                      </button>
                      <button
                        aria-label={`Stop ${t.name} terminal`}
                        onClick={() =>
                          setTerminals((current) => current.filter((x) => x.id !== t.id))
                        }
                        className="p-1.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {terminals.map((t) => (
                <div
                  key={t.id}
                  data-agent-terminal
                  style={{
                    display:
                      selectedTerminal === t.id ||
                      (!terminals.some((x) => x.id === selectedTerminal) &&
                        terminals[0]?.id === t.id)
                        ? 'flex'
                        : 'none',
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <TerminalPane id={t.id} cwd={t.cwd} toolId={t.toolId} />
                </div>
              ))}
              {!terminals.length && (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                  <Bot className="text-fg-dim mb-4 h-8 w-8" />
                  <h3 className="text-[15px] font-medium">A workspace for every tool</h3>
                  <p className="text-fg-muted mt-3 max-w-sm text-[12px] leading-relaxed">
                    Enable a native or ACP tool to use it in the task composer. Open terminal tools
                    here to use their complete interactive interface.
                  </p>
                  <p className="text-fg-dim mt-3 text-[11px]">
                    Terminal processes stay open when you close this panel.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );
});
