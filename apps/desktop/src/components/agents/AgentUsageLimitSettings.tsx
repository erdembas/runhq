import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import { Loader2, Save } from 'lucide-react';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useVisibleStore } from '@/lib/useVisibleStore';
import {
  AGENT_USAGE_THRESHOLD_FIELDS,
  agentUsagePreferences,
  evaluateAgentUsage,
  validateAgentUsagePreferences,
} from './agentUsagePolicy';

const labels = {
  get tokenWarning() {
    return i18n.t('Warn at reported tokens');
  },
  get tokenPause() {
    return i18n.t('Pause queue at reported tokens');
  },
  get usdWarning() {
    return i18n.t('Warn at reported USD');
  },
  get usdPause() {
    return i18n.t('Pause queue at reported USD');
  },
};

export function AgentUsageLimitSettings({ visible = true }: { visible?: boolean }) {
  i18n.useLocale();
  const saved = useVisibleStore(
    useAgentLibraryStore,
    (state) => state.records['preferences:usage'],
    visible,
  );
  const ready = useVisibleStore(useAgentLibraryStore, (state) => state.ready, visible);
  const tools = useVisibleStore(useAgentStore, (state) => state.tools, visible);
  const sessions = useVisibleStore(useAgentStore, (state) => state.sessions, visible);
  const preferences = useMemo(() => agentUsagePreferences(saved?.value), [saved]);
  const [draft, setDraft] = useState(preferences);
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(preferences), [preferences]);
  const providerIds = [
    ...new Set([
      ...tools.map((tool) => tool.id),
      ...Object.values(sessions).map((session) => session.backend),
      ...Object.keys(draft.providers),
    ]),
  ];
  const selected = provider || providerIds[0] || '';
  const rule = draft.providers[selected] ?? {};
  const reports = Object.values(sessions)
    .filter((session) => session.backend === selected)
    .sort((left, right) => right.updated_at - left.updated_at);
  const support = reports.length
    ? evaluateAgentUsage(reports[0]!.usage, rule)
    : evaluateAgentUsage(null, rule);
  const validation = validateAgentUsagePreferences(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);
  const save = async () => {
    if (validation || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await useAgentLibraryStore.getState().save('preferences:usage', draft);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label={i18n.t('Reported usage rules')}
      className="border-border rounded-xl border p-4"
    >
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h3 className="text-fg text-[12px] font-medium">{i18n.t('Reported usage rules')}</h3>
          <p className="text-fg-dim mt-1 text-[11px]">
            {i18n.t(
              'Choose warnings and when to pause queued followups for each tool. Each comparison uses its latest report: a thread total, latest turn or latest message. Running tasks continue; these rules do not cap account spending.',
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || !dirty || busy || !!validation}
          onClick={() => void save()}
          className="bg-accent text-accent-fg flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {busy ? i18n.t('Saving…') : i18n.t('Save rules')}
        </button>
      </div>
      <fieldset disabled={!ready || busy} className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <SearchableSelect
            label={i18n.t('Usage rules tool')}
            searchable={false}
            className="w-40 max-w-full"
            menuWidth={220}
            placeholder={i18n.t('No tools available')}
            value={selected}
            options={providerIds.map((id) => ({
              value: id,
              label: tools.find((tool) => tool.id === id)?.name ?? id,
            }))}
            onChange={setProvider}
          />
          <label className="text-fg-muted flex items-center gap-2 text-[12px]">
            {i18n.rich('{value1}Show in-app threshold alerts', {
              value1: (
                <input
                  type="checkbox"
                  checked={draft.notifications}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, notifications: event.target.checked }))
                  }
                />
              ),
            })}
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENT_USAGE_THRESHOLD_FIELDS.map((field) => (
            <label key={field} className="text-fg-muted space-y-1.5 text-[11px]">
              <span className="block">{labels[field]}</span>
              <input
                type="number"
                disabled={!selected}
                aria-label={labels[field]}
                min={field.startsWith('token') ? 1 : 0.000001}
                step={field.startsWith('token') ? 1 : 'any'}
                placeholder={i18n.t('Off')}
                value={rule[field] ?? ''}
                onChange={(event) =>
                  setDraft((current) => {
                    const next = { ...(current.providers[selected] ?? {}) };
                    if (!event.target.value) delete next[field];
                    else next[field] = Number(event.target.value);
                    return { ...current, providers: { ...current.providers, [selected]: next } };
                  })
                }
                className="bg-surface border-border text-fg w-full rounded-lg border px-2 py-1.5 text-[12px]"
              />
            </label>
          ))}
        </div>
      </fieldset>
      {(validation || error) && (
        <p role="alert" className="text-status-error mt-3 text-[11px]">
          {validation || error}
        </p>
      )}
      {support.unsupported.map((message) => (
        <p key={message} className="text-fg-dim mt-2 text-[11px]">
          {i18n.rich('{message} Its queue is not blocked by unavailable data.', {
            message: message,
          })}
        </p>
      ))}
    </section>
  );
}
