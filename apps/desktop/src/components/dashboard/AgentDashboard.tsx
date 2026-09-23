import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CircleCheck,
  CircleHelp,
  FolderGit2,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import { Button } from '@/components/ui/Button';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { AgentDashboardCard } from './AgentDashboardCard';
import { buildAgentDashboard, type AgentDashboardFilter } from './agentDashboardModel';

const AgentNewSession = lazy(() =>
  import('../agents/AgentNewSession').then((module) => ({ default: module.AgentNewSession })),
);
const statuses = [
  {
    value: 'attention',
    get label() {
      return i18n.t('Needs attention');
    },
    get detail() {
      return i18n.t('Questions, approvals & issues');
    },
    icon: CircleHelp,
    tone: 'text-accent',
    bg: 'bg-accent/10',
  },
  {
    value: 'working',
    get label() {
      return i18n.t('Working');
    },
    get detail() {
      return i18n.t('Agents making progress');
    },
    icon: Loader2,
    tone: 'text-status-running',
    bg: 'bg-status-running/10',
  },
  {
    value: 'ready',
    get label() {
      return i18n.t('Ready');
    },
    get detail() {
      return i18n.t('Ready to start or continue');
    },
    icon: Inbox,
    tone: 'text-fg-muted',
    bg: 'bg-fg/5',
  },
  {
    value: 'completed',
    get label() {
      return i18n.t('Completed');
    },
    get detail() {
      return i18n.t('Responses ready to review');
    },
    icon: CircleCheck,
    tone: 'text-cat-frontend',
    bg: 'bg-cat-frontend/10',
  },
] as const;

function openTask(id: string) {
  const store = useAgentStore.getState();
  store.open(store.sessions[id]?.project_id ?? '');
  store.select(id);
}

export function AgentDashboard({ visible }: { visible: boolean }) {
  i18n.useLocale();
  const sessions = useVisibleStore(useAgentStore, (state) => state.sessions, visible);
  const projects = useVisibleStore(useAgentStore, (state) => state.projects, visible);
  const ready = useVisibleStore(useAgentStore, (state) => state.ready, visible);
  const error = useVisibleStore(useAgentStore, (state) => state.error, visible);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [filter, setFilter] = useState<AgentDashboardFilter>('all');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const model = useMemo(
    () => buildAgentDashboard(sessions, projects, { query, projectId, filter }),
    [sessions, projects, query, projectId, filter],
  );
  const filtered = Boolean(query || projectId || filter !== 'all');
  const refresh = async () => {
    setRefreshing(true);
    try {
      await useAgentStore.getState().refresh();
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!visible || creating) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return;
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, creating]);

  if (creating)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-8">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={() => setCreating(false)}
          >
            {i18n.t('Back to dashboard')}
          </Button>
        </div>
        <Suspense
          fallback={
            <div role="status" className="text-fg-dim p-8 text-sm">
              {i18n.t('Loading task composer…')}
            </div>
          }
        >
          <AgentNewSession
            visible={visible}
            project={projects.find((project) => project.id === projectId)}
            onClose={() => setCreating(false)}
            onCreated={(session) => openTask(session.id)}
          />
        </Suspense>
      </div>
    );

  return (
    <section
      aria-label={i18n.t('Agent dashboard')}
      className="overlay-scroll min-h-0 min-w-0 flex-1 overflow-y-auto"
    >
      <div className="@container/agents mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="text-fg-dim mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-fg-muted inline-flex items-center gap-2 font-semibold tracking-[0.14em] uppercase">
                {i18n.rich('{value1}Agents', {
                  value1: <Bot className="text-accent h-3.5 w-3.5" />,
                })}
              </span>
              {ready && (
                <span>
                  {i18n.rich('· {value1} tasks · {value2} projects', {
                    value1: model.total,
                    value2: model.projectOptions.length,
                  })}
                </span>
              )}
            </div>
            <h1 className="text-fg text-[32px] leading-[1.1] font-semibold tracking-tight">
              {i18n.t('Agent dashboard')}
            </h1>
            <p className="text-fg-muted mt-3 text-[12px]">
              {i18n.t('Follow your agents across projects. Open a task to review or continue.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              leftIcon={<ArrowUpRight className="h-3.5 w-3.5" />}
              onClick={() => useAgentStore.getState().open('')}
            >
              {i18n.t('Open agents')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              disabled={!ready || !projects.length}
              onClick={() => setCreating(true)}
            >
              {i18n.t('New task')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={i18n.t('Refresh agent dashboard')}
              title={i18n.t('Refresh agent dashboard')}
              disabled={refreshing || !ready}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="border-status-error/25 bg-status-error/5 text-status-error rounded-lg border p-3 text-[12px]"
          >
            {i18n.rich('Could not refresh agent tasks. {error} {value1}', {
              error: error,
              value1: (
                <button
                  type="button"
                  disabled={refreshing}
                  className="ml-2 underline disabled:opacity-50"
                  onClick={() => void refresh()}
                >
                  {i18n.t('Retry')}
                </button>
              ),
            })}
          </div>
        )}
        <div
          role="group"
          aria-label={i18n.t('Filter agents by status')}
          className="grid grid-cols-2 gap-3 @3xl/agents:grid-cols-4"
        >
          {statuses.map(({ value, label, detail, icon: Icon, tone, bg }) => (
            <button
              key={value}
              type="button"
              disabled={!ready}
              aria-pressed={filter === value}
              onClick={() => setFilter((current) => (current === value ? 'all' : value))}
              className={`bg-surface-raised focus-visible:ring-accent/40 min-w-0 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 ${filter === value ? 'border-accent/50 ring-accent/15 ring-1' : 'border-border/70 hover:border-fg/20'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-muted text-[11px] font-medium">{label}</span>
                <span className={`rounded-lg p-1.5 ${tone} ${bg}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
              </div>
              <span
                className={`mt-2 block text-[28px] leading-none font-semibold tabular-nums ${tone}`}
              >
                {ready ? model.counts[value] : '—'}
              </span>
              <span className="text-fg-dim mt-2 block text-[10px]">{detail}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="border-border bg-surface-raised focus-within:border-accent/40 flex w-72 max-w-full items-center gap-2 rounded-lg border px-3">
            <Search className="text-fg-dim h-3.5 w-3.5 shrink-0" aria-hidden />
            <input
              ref={search}
              aria-label={i18n.t('Search agent tasks')}
              placeholder={i18n.t('Search tasks, agents, models…')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="text-fg placeholder:text-fg-dim min-w-0 flex-1 bg-transparent py-2 text-[12px] outline-none"
            />
            {query ? (
              <button
                type="button"
                aria-label={i18n.t('Clear agent search')}
                className="text-fg-dim hover:text-fg"
                onClick={() => {
                  setQuery('');
                  search.current?.focus();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="text-fg-dim text-[10px]">/</kbd>
            )}
          </div>
          <SearchableSelect
            label={i18n.t('Filter agent projects')}
            value={projectId}
            onChange={setProjectId}
            compact
            leading={<FolderGit2 className="h-3.5 w-3.5" />}
            options={[{ value: '', label: i18n.t('All projects') }, ...model.projectOptions]}
            className="max-w-56"
          />
          <SearchableSelect
            label={i18n.t('Filter agent status')}
            value={filter}
            onChange={(value) => setFilter(value as AgentDashboardFilter)}
            compact
            searchable={false}
            options={[
              { value: 'all', label: i18n.t('All tasks') },
              ...statuses.map(({ value, label }) => ({ value, label })),
            ]}
            className="max-w-44"
          />
          {filtered && (
            <button
              type="button"
              className="text-fg-dim hover:text-fg text-[11px]"
              onClick={() => {
                setQuery('');
                setProjectId('');
                setFilter('all');
              }}
            >
              {i18n.t('Clear filters')}
            </button>
          )}
          {ready && (
            <span role="status" className="text-fg-dim ml-auto text-[11px] tabular-nums">
              {model.matchedTotal} {model.matchedTotal === 1 ? i18n.t('task') : i18n.t('tasks')}
            </span>
          )}
        </div>
        {!ready ? (
          <div
            role="status"
            className="text-fg-dim flex items-center justify-center gap-2 py-20 text-[12px]"
          >
            {i18n.rich('{value1}Loading agent tasks…', {
              value1: <Loader2 className="h-4 w-4 animate-spin" />,
            })}
          </div>
        ) : model.groups.length ? (
          model.groups.map((group) => (
            <section
              key={group.id}
              aria-label={i18n.t('{value1} agent tasks', { value1: group.name })}
            >
              <div className="mb-3 flex min-w-0 items-center gap-2.5">
                <FolderGit2 className="text-accent h-3.5 w-3.5 shrink-0" aria-hidden />
                <h2 className="text-fg-muted truncate text-[12px] font-semibold tracking-wide">
                  {group.name}
                </h2>
                <span className="bg-fg/4 text-fg-dim rounded-full px-2 py-0.5 text-[10px] tabular-nums">
                  {group.sessions.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 @xl/agents:grid-cols-2 @4xl/agents:grid-cols-3">
                {group.sessions.map((session) => (
                  <AgentDashboardCard
                    key={session.id}
                    session={session}
                    onOpen={() => openTask(session.id)}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          !error && (
            <div className="border-border/70 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
              <Bot className="text-fg-dim h-7 w-7" aria-hidden />
              <h2 className="text-fg text-[16px] font-medium">
                {filtered ? i18n.t('No matching tasks') : i18n.t('Your agents start here')}
              </h2>
              <p className="text-fg-muted max-w-sm text-[12px] leading-relaxed">
                {filtered
                  ? i18n.t('Try another search or clear your filters.')
                  : i18n.t(
                      'Start a task to see its progress here. Archived conversations stay in the Agents workspace.',
                    )}
              </p>
              {filtered ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setProjectId('');
                    setFilter('all');
                  }}
                >
                  {i18n.t('Clear filters')}
                </Button>
              ) : projects.length ? (
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setCreating(true)}
                >
                  {i18n.t('New task')}
                </Button>
              ) : (
                <Button size="sm" onClick={() => useAgentStore.getState().open('')}>
                  {i18n.t('Set up agents')}
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </section>
  );
}
