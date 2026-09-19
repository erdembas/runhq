import { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, Save } from 'lucide-react';
import { AgentProviderLogo, SearchableSelect } from '@runhq/cockpit-ui';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentQueueStore } from '@/store/useAgentQueueStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { agentUsageSummary } from './agentLibraryModel';
import { AgentAccountCooldowns } from './AgentAccountCooldowns';
import { AgentUsageLimitSettings } from './AgentUsageLimitSettings';
import { agentUsagePreferences, evaluateAgentUsage } from './agentUsagePolicy';
import { agentTaskTiming } from './agentDuration';
import {
  agentCapacityPreferences,
  agentCapacityWaitReason,
  agentExecutionState,
  agentOccupiedSlots,
  type AgentCapacityPreferences,
} from './agentCapacity';

const limits = Array.from({ length: 8 }, (_, index) => index + 1);
const count = (value: number | null) => (value === null ? 'Unknown' : value.toLocaleString());

export function AgentUsagePanel({
  projectId,
  visible = true,
}: {
  projectId?: string;
  visible?: boolean;
}) {
  const sessions = useVisibleStore(useAgentStore, (state) => state.sessions, visible);
  const tools = useVisibleStore(useAgentStore, (state) => state.tools, visible);
  const queues = useVisibleStore(useAgentQueueStore, (state) => state.queues, visible);
  const saved = useVisibleStore(
    useAgentLibraryStore,
    (state) => state.records['preferences:capacity'],
    visible,
  );
  const ready = useVisibleStore(useAgentLibraryStore, (state) => state.ready, visible);
  const libraryError = useVisibleStore(useAgentLibraryStore, (state) => state.error, visible);
  const preferences = useMemo(() => agentCapacityPreferences(saved?.value), [saved]);
  const usageSaved = useVisibleStore(
    useAgentLibraryStore,
    (state) => state.records['preferences:usage'],
    visible,
  );
  const usagePreferences = useMemo(() => agentUsagePreferences(usageSaved?.value), [usageSaved]);
  const [draft, setDraft] = useState<AgentCapacityPreferences>(preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => setDraft(preferences), [preferences]);
  useEffect(() => {
    if (visible && !ready) void useAgentLibraryStore.getState().refresh();
  }, [visible, ready]);
  const anyRunning = Object.values(sessions).some((session) => session.turn_started_at);
  useEffect(() => {
    // Only tick while a turn is actually being measured, so an idle workspace stays still.
    if (!visible || !anyRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, anyRunning]);
  const occupied = useMemo(() => agentOccupiedSlots(sessions, queues), [sessions, queues]);
  const all = useMemo(
    () =>
      Object.values(sessions).filter((session) => !projectId || session.project_id === projectId),
    [sessions, projectId],
  );
  const providerIds = useMemo(
    () => [
      ...new Set([
        ...tools.map((tool) => tool.id),
        ...Object.values(sessions).map((session) => session.backend),
      ]),
    ],
    [sessions, tools],
  );
  const providerName = (id: string) => tools.find((tool) => tool.id === id)?.name ?? id;
  const rows = all
    .filter((session) => !provider || session.backend === provider)
    .sort((left, right) => right.updated_at - left.updated_at);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await useAgentLibraryStore.getState().save('preferences:capacity', draft);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      aria-label="Agent usage and capacity"
      className="overlay-scroll min-h-0 flex-1 space-y-5 overflow-auto p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Activity className="text-accent h-4 w-4" />
        <h2 className="text-fg text-[14px] font-semibold">Capacity & usage</h2>
        <span className="text-fg-dim ml-auto text-[12px]">
          {occupied.total} / {ready ? preferences.global : '…'} execution slots in use
        </span>
      </header>
      {(error || libraryError) && (
        <div
          role="alert"
          className="text-status-error flex flex-wrap items-center gap-2 text-[12px]"
        >
          <span>{error || libraryError}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void useAgentLibraryStore.getState().refresh();
            }}
            className="underline"
          >
            Reload saved settings
          </button>
        </div>
      )}
      <div className="border-border rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h3 className="text-fg text-[12px] font-medium">Concurrent tasks</h3>
            <p className="text-fg-dim mt-1 text-[11px]">
              Limits apply across all projects. Tasks waiting for your answer still occupy a slot;
              changing limits does not stop tasks already running.
            </p>
          </div>
          <button
            type="button"
            disabled={!ready || !dirty || saving}
            onClick={() => void save()}
            className="bg-accent text-accent-fg flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? 'Saving…' : 'Save limits'}
          </button>
        </div>
        <fieldset disabled={!ready || saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-fg-muted flex items-center justify-between gap-3 text-[12px]">
            All tools
            <SearchableSelect
              label="Global concurrent tasks"
              searchable={false}
              compact
              className="w-24"
              menuWidth={160}
              value={String(draft.global)}
              options={limits.map((limit) => ({ value: String(limit), label: String(limit) }))}
              onChange={(value) => setDraft((current) => ({ ...current, global: Number(value) }))}
            />
          </label>
          {providerIds.map((id) => (
            <label
              key={id}
              className="text-fg-muted flex items-center justify-between gap-3 text-[12px]"
            >
              <span className="truncate">{providerName(id)}</span>
              <SearchableSelect
                label={`${providerName(id)} concurrent tasks`}
                searchable={false}
                compact
                className="w-32"
                menuWidth={180}
                value={draft.providers[id] === undefined ? '' : String(draft.providers[id])}
                options={[
                  { value: '', label: 'Global limit' },
                  ...limits.map((limit) => ({ value: String(limit), label: String(limit) })),
                ]}
                onChange={(value) =>
                  setDraft((current) => {
                    const providers = { ...current.providers };
                    if (value) providers[id] = Number(value);
                    else delete providers[id];
                    return { ...current, providers };
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        {!ready && (
          <p className="text-fg-dim mt-3 text-[11px]">
            {libraryError
              ? 'Limits unavailable. Queued messages remain paused until saved settings load.'
              : 'Loading saved limits…'}
          </p>
        )}
      </div>
      <AgentAccountCooldowns visible={visible} />
      <AgentUsageLimitSettings visible={visible} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {providerIds.map((id) => {
          const tasks = all.filter((session) => session.backend === id);
          const reported = tasks
            .map((session) => agentUsageSummary(session.usage))
            .filter((usage) => usage.total !== null);
          const tokens = reported.reduce((total, usage) => total + (usage.total ?? 0), 0);
          const queued = tasks.reduce(
            (total, session) => total + (queues[session.id]?.length ?? 0),
            0,
          );
          return (
            <div key={id} className="border-border rounded-xl border p-3">
              <div className="flex items-center gap-2 text-[12px]">
                <AgentProviderLogo backend={id} className="h-4 w-4" />
                <strong className="text-fg font-medium">{providerName(id)}</strong>
                <span className="text-fg-dim ml-auto">
                  {occupied.providers[id] ?? 0} /{' '}
                  {ready ? Math.min(preferences.global, preferences.providers[id] ?? 8) : '…'} slots
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <dt className="text-fg-dim text-[10px]">Saved token snapshots</dt>
                  <dd className="text-fg mt-0.5 tabular-nums">
                    {reported.length ? count(tokens) : 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-dim text-[10px]">Queued messages</dt>
                  <dd className="text-fg mt-0.5 tabular-nums">{queued}</dd>
                </div>
              </dl>
              <p className="text-fg-dim mt-2 text-[10px]">
                {reported.length} of {tasks.length} tasks report token totals.
              </p>
            </div>
          );
        })}
      </div>
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-fg text-[12px] font-medium">
            Task reports{projectId ? ' · current project' : ''}
          </h3>
          <SearchableSelect
            label="Usage provider filter"
            searchable={false}
            className="w-40 max-w-full"
            menuWidth={220}
            value={provider}
            options={[
              { value: '', label: 'All tools' },
              ...providerIds.map((id) => ({ value: id, label: providerName(id) })),
            ]}
            onChange={setProvider}
          />
        </div>
        <div className="border-border overflow-auto rounded-xl border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-fg/3 text-fg-dim">
              <tr>
                {[
                  'Task',
                  'State / waiting cause',
                  'Time (measured here)',
                  'Input',
                  'Output',
                  'Total',
                  'Reported cost',
                  'Scope',
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => {
                const usage = agentUsageSummary(session.usage);
                const timing = agentTaskTiming(session, now);
                const queue = queues[session.id] ?? [];
                const waiting =
                  evaluateAgentUsage(session.usage, usagePreferences.providers[session.backend])
                    .pauseReason ??
                  (ready
                    ? agentCapacityWaitReason(session.backend, preferences, occupied)
                    : 'Waiting for saved capacity settings');
                const disabled =
                  tools.find((tool) => tool.id === session.backend)?.enabled === false;
                const state =
                  disabled && queue.length
                    ? 'Tool disabled · queue paused'
                    : agentExecutionState(session, queue, waiting);
                return (
                  <tr key={session.id} className="border-border/60 border-t">
                    <td className="max-w-64 px-3 py-3">
                      <div className="text-fg truncate" title={session.title}>
                        {session.title}
                      </div>
                      <div className="text-fg-dim mt-0.5 truncate">
                        {session.project_name} · {providerName(session.backend)}
                      </div>
                    </td>
                    <td className="text-fg-muted max-w-64 px-3 py-3" title={queue[0]?.error}>
                      {state}
                      {queue.length > 0 && (
                        <span className="text-fg-dim block">{queue.length} queued</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      <span className="text-fg">
                        {timing.current ?? 'Not measured'}
                        {timing.isRunning && timing.current ? ' · running' : ''}
                      </span>
                      {timing.total && (
                        <span className="text-fg-dim block">{timing.total} total</span>
                      )}
                    </td>
                    {[usage.input, usage.output, usage.total].map((value, index) => (
                      <td key={index} className="text-fg px-3 py-3 whitespace-nowrap tabular-nums">
                        {count(value)}
                      </td>
                    ))}
                    <td className="text-fg px-3 py-3 whitespace-nowrap tabular-nums">
                      {usage.cost === null
                        ? 'Unknown'
                        : `${usage.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${usage.currency ?? '(unspecified currency)'}`}
                    </td>
                    <td className="text-fg-dim px-3 py-3 whitespace-nowrap">
                      {usage.scope === 'unknown' ? 'Not reported' : `Latest ${usage.scope} report`}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="text-fg-dim px-4 py-8 text-center">
                    No task usage to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-fg-dim mt-2 text-[10px]">
          Saved token snapshots sum the latest report from each task. Providers report different
          scopes; these values are not lifetime usage or account billing. Missing values remain
          unknown.
        </p>
      </div>
    </section>
  );
}
