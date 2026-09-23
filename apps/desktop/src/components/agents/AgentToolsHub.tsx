import * as i18n from '@runhq/cockpit-ui/i18n';
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
import { environmentLines, parseEnvironmentLines } from './agentConnectionEnv';
import { AgentAccountPools } from './AgentAccountPools';

const field =
  'border-fg/10 bg-fg/3 text-fg focus:border-fg/25 w-full rounded-xl border px-3 py-2 text-[12px]';
const detectionOrder = { available: 0, blocked: 1, not_found: 2 };
const detectionLabels = {
  get available() {
    return i18n.t('Installed');
  },
  get blocked() {
    return i18n.t('Setup required');
  },
  get not_found() {
    return i18n.t('Missing');
  },
};
const configuration = (tool: AgentBackend): AgentTool => ({
  id: tool.id,
  name: tool.name,
  adapter: tool.adapter || 'acp',
  executable: tool.command || tool.executable || tool.id,
  args: tool.args ?? [],
  env: tool.env ?? {},
  enabled: tool.enabled !== false,
});
export const AgentToolsHub = memo(function AgentToolsHub() {
  i18n.useLocale();
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
    [environment, setEnvironment] = useState(''),
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
    setEnvironment(environmentLines(tool.env));
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
      aria-label={i18n.t('Agent tools')}
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
            <h2 className="text-[15px] font-semibold">{i18n.t('Agent tools')}</h2>
            <p className="text-fg-dim mt-0.5 text-[11px]">
              {i18n.t('Local agents, connections and terminal sessions')}
            </p>
          </div>
          <span className="flex-1" />
          <button
            aria-label={i18n.t('Refresh tool detection')}
            disabled={discovery.loading}
            onClick={() => void discovery.refresh()}
            className="text-fg-muted hover:bg-fg/5 flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${discovery.loading ? 'animate-spin' : ''}`} />
            {discovery.loading ? i18n.t('Checking…') : i18n.t('Re-scan')}
          </button>
          <button
            aria-label={i18n.t('Close agent tools')}
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
                    aria-label={i18n.t('Search agent tools')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={i18n.t('Find a tool…')}
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
                      env: {},
                      enabled: true,
                    })
                  }
                  className="bg-fg text-surface flex items-center gap-1.5 rounded-xl px-3 text-[12px]"
                >
                  {i18n.rich('{value1}Add tool', { value1: <Plus className="h-3.5 w-3.5" /> })}
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
                              ? i18n.t('Terminal interface')
                              : tool.adapter === 'acp'
                                ? i18n.t('ACP connection')
                                : i18n.t('Native integration')}
                            {tool.enabled === false && i18n.t(' · Disabled')}
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={i18n.t('Enable {value1}', { value1: tool.name })}
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
                          {i18n.t(
                            "Agent, Plan and Ask through the installed CLI's ACP connection.",
                          )}
                        </p>
                      )}
                      <AgentToolDetectionDetails tool={tool} />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          disabled={busy}
                          onClick={() => beginEdit(configuration(tool))}
                          className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px]"
                        >
                          {i18n.t('Configure')}
                        </button>
                        <button
                          type="button"
                          title={i18n.t(
                            'Create a second connection to this tool for another account',
                          )}
                          onClick={() => {
                            const source = configuration(tool);
                            beginEdit({
                              ...source,
                              id: `tool-${crypto.randomUUID()}`,
                              name: i18n.t('{value1} (second account)', { value1: source.name }),
                            });
                          }}
                          className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px]"
                        >
                          {i18n.t('Add account')}
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
                            {i18n.rich('{value1}Open terminal', {
                              value1: <Terminal className="h-3 w-3" />,
                            })}
                          </button>
                        ) : (
                          <button
                            disabled={busy || tool.enabled === false || !tool.available || !project}
                            onClick={() =>
                              void action(async () => {
                                if (!project) return;
                                const catalog = await ipc.agentCatalog(tool.id, '', project.id);
                                setNotice(
                                  i18n.t('{value1}: connected · {value2} models{value3}', {
                                    value1: tool.name,
                                    value2: catalog.models.length,
                                    value3:
                                      catalog.connection === 'acp'
                                        ? `${catalog.agents.length ? i18n.t(' · modes: {value1}', { value1: catalog.agents.join(', ') }) : ''}${catalog.can_resume ? i18n.t(' · session resume supported') : i18n.t(' · session resume not advertised')}`
                                        : '',
                                  }),
                                );
                              })
                            }
                            className="bg-fg/5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
                          >
                            {i18n.rich('{value1}Test connection', {
                              value1: <Check className="h-3 w-3" />,
                            })}
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
                            {i18n.rich('{value1}Open CLI', {
                              value1: <Terminal className="h-3 w-3" />,
                            })}
                          </button>
                        )}
                        {(running > 0 || terminalCount > 0) && (
                          <button
                            disabled={busy}
                            onClick={() => void action(() => stop(tool.id))}
                            className="text-status-error flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
                          >
                            {i18n.rich('{value1}Stop ({value2})', {
                              value1: <Square className="h-3 w-3" />,
                              value2: running + terminalCount,
                            })}
                          </button>
                        )}
                      </div>
                      <p className="text-fg-dim mt-2 text-[10px]">
                        {i18n.rich('{running} working · {terminalCount} terminals open', {
                          running: running,
                          terminalCount: terminalCount,
                        })}
                      </p>
                    </article>
                  </Fragment>
                );
              })}
              {!filtered.length && (
                <p className="text-fg-dim py-8 text-center text-[12px]">
                  {discovery.loading && !tools.length
                    ? i18n.t('Looking for your agent tools…')
                    : discovery.error && !tools.length
                      ? i18n.t('Re-scan to load your local agent tools.')
                      : query.trim()
                        ? i18n.t('No tools match your search.')
                        : discovery.ready
                          ? i18n.t('No tools are configured. Add an agent tool to get started.')
                          : i18n.t('Agent detection is starting…')}
                </p>
              )}
              <AgentAccountPools visible={open} />
            </div>
            <p className="border-fg/8 text-fg-dim border-t px-4 py-3 text-[10px] leading-relaxed">
              {i18n.t(
                'Disabling a tool prevents new starts. Existing sessions and terminals keep running.',
              )}
            </p>
          </section>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="border-fg/8 flex items-center gap-2 border-b p-3">
              <span className="text-fg-dim text-[11px]">{i18n.t('Project')}</span>
              <SearchableSelect
                label={i18n.t('Tool project')}
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
                    const { env, invalid } = parseEnvironmentLines(environment);
                    if (invalid)
                      throw new Error(
                        i18n.t('Environment needs KEY=value on every line. Fix: {invalid}', {
                          invalid: invalid,
                        }),
                      );
                    await save({
                      ...edit,
                      args:
                        edit.adapter === 'acp' || edit.adapter === 'terminal'
                          ? args.split('\n').filter(Boolean)
                          : [],
                      env,
                    });
                    setEdit(null);
                    setNotice(i18n.t('Tool saved. New sessions use this configuration.'));
                  });
                }}
                className="overlay-scroll min-h-0 flex-1 space-y-4 overflow-auto p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-medium">
                    {tools.some((t) => t.id === edit.id)
                      ? i18n.t('Configure tool')
                      : i18n.t('Add an agent tool')}
                  </h3>
                  <button
                    type="button"
                    aria-label={i18n.t('Close tool configuration')}
                    onClick={() => setEdit(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <label className="block text-[11px]">
                  {i18n.rich('Name{value1}', {
                    value1: (
                      <input
                        required
                        maxLength={200}
                        className={`${field} mt-1.5`}
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      />
                    ),
                  })}
                </label>
                <label className="block text-[11px]">
                  {i18n.rich('Connection{value1}', {
                    value1: (
                      <div className="mt-1.5">
                        <SearchableSelect
                          label={i18n.t('Tool connection')}
                          value={edit.adapter}
                          onChange={(value) =>
                            setEdit({ ...edit, adapter: value as AgentTool['adapter'] })
                          }
                          disabled={['codex', 'opencode', 'claude', 'cursor'].includes(edit.id)}
                          options={[
                            {
                              value: 'acp',
                              label: i18n.t('ACP · Integrated conversation'),
                              description: i18n.t(
                                'Messages, permissions and agent-advertised models / modes',
                              ),
                            },
                            {
                              value: 'terminal',
                              label: i18n.t('Terminal · Any interactive CLI'),
                              description: i18n.t(
                                'Use the tool’s own model, login, question and permission UI',
                              ),
                            },
                            ...['codex', 'opencode', 'claude'].map((value) => ({
                              value,
                              label: i18n.t('{value} · Native adapter', { value: value }),
                            })),
                          ]}
                          className="w-full"
                        />
                      </div>
                    ),
                  })}
                </label>
                <label className="block text-[11px]">
                  {i18n.rich('Executable{value1}', {
                    value1: (
                      <input
                        required
                        className={`${field} mt-1.5`}
                        value={edit.executable}
                        onChange={(e) => setEdit({ ...edit, executable: e.target.value })}
                        placeholder={i18n.t('Executable name on PATH or absolute path')}
                      />
                    ),
                  })}
                </label>
                {(edit.adapter === 'acp' || edit.adapter === 'terminal') && (
                  <label className="block text-[11px]">
                    {i18n.rich('Arguments · one per line{value1}', {
                      value1: (
                        <textarea
                          rows={3}
                          className={`${field} mt-1.5 resize-y font-mono`}
                          value={args}
                          onChange={(e) => setArgs(e.target.value)}
                          placeholder={i18n.t('Each line is passed as one argument')}
                        />
                      ),
                    })}
                  </label>
                )}
                <label className="block text-[11px]">
                  {i18n.rich('Account environment · KEY=value per line{value1}{value2}', {
                    value1: (
                      <textarea
                        rows={3}
                        className={`${field} mt-1.5 resize-y font-mono`}
                        value={environment}
                        onChange={(e) => setEnvironment(e.target.value)}
                        placeholder={i18n.t('CODEX_HOME=/Users/you/.codex-work')}
                      />
                    ),
                    value2: (
                      <span className="text-fg-dim mt-1 block leading-relaxed">
                        {i18n.t(
                          'Point a second connection at another provider configuration home to run it as a separate account. Log in to that home yourself with the tool’s own CLI; RunHQ never creates or stores credentials. PATH and RUNHQ_ names are reserved.',
                        )}
                      </span>
                    ),
                  })}
                </label>
                <p className="text-fg-dim text-[11px] leading-relaxed">
                  {i18n.rich('{value1} Arguments are passed directly, without shell expansion.', {
                    value1:
                      edit.adapter === 'acp'
                        ? i18n.t(
                            'Use an installed ACP-compatible executable and the arguments documented by that tool. Capabilities and authentication depend on the agent.',
                          )
                        : edit.adapter === 'terminal'
                          ? i18n.t(
                              'Terminal tools run directly in the selected project. Their interactive prompts and controls stay in the embedded terminal.',
                            )
                          : i18n.t(
                              'Choose a compatible installed CLI for this native integration.',
                            ),
                  })}
                </p>
                <button
                  disabled={busy}
                  className="bg-fg text-surface flex items-center gap-2 rounded-xl px-4 py-2 text-[12px]"
                >
                  {i18n.rich('{value1}Save tool', {
                    value1: busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                  })}
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
                        aria-label={i18n.t('Stop {value1} terminal', { value1: t.name })}
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
                  <h3 className="text-[15px] font-medium">
                    {i18n.t('A workspace for every tool')}
                  </h3>
                  <p className="text-fg-muted mt-3 max-w-sm text-[12px] leading-relaxed">
                    {i18n.t(
                      'Enable a native or ACP tool to use it in the task composer. Open terminal tools here to use their complete interactive interface.',
                    )}
                  </p>
                  <p className="text-fg-dim mt-3 text-[11px]">
                    {i18n.t('Terminal processes stay open when you close this panel.')}
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
