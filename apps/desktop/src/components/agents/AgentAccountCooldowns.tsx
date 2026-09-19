import { useEffect, useMemo, useState } from 'react';
import { TimerReset } from 'lucide-react';
import { AgentProviderLogo } from '@runhq/cockpit-ui';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { formatAgentDuration } from './agentDuration';
import { parseAccountCooldowns, pruneCooldowns } from './agentAccountRouting';

const COOLDOWN_KEY = 'preferences:cooldowns';

/**
 * What RunHQ is withholding and why. A cool-down is RunHQ's own backoff after a limit the provider
 * actually reported — these CLIs do not publish a remaining allowance, so nothing here is a reading
 * of one, and no reset time is claimed on the provider's behalf.
 */
export function AgentAccountCooldowns({ visible = true }: { visible?: boolean }) {
  const tools = useVisibleStore(useAgentStore, (state) => state.tools, visible);
  const saved = useVisibleStore(
    useAgentLibraryStore,
    (state) => state.records[COOLDOWN_KEY],
    visible,
  );
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const cooldowns = useMemo(() => parseAccountCooldowns(saved?.value), [saved]);
  const active = useMemo(
    () =>
      Object.entries(cooldowns)
        .filter(([, cooldown]) => cooldown.until > now)
        .sort((left, right) => left[1].until - right[1].until),
    [cooldowns, now],
  );
  useEffect(() => {
    if (!visible || !active.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, active.length]);
  const name = (id: string) => tools.find((tool) => tool.id === id)?.name ?? id;
  const resume = async (id: string) => {
    setClearing(id);
    setError(null);
    try {
      const rest = pruneCooldowns(cooldowns, now);
      const next = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== id));
      await useAgentLibraryStore
        .getState()
        .save(COOLDOWN_KEY, Object.keys(next).length ? next : null);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setClearing(null);
    }
  };
  return (
    <div className="border-border rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TimerReset className="text-accent h-4 w-4" />
        <h3 className="text-fg text-[12px] font-medium">Account cool-downs</h3>
        <span className="text-fg-dim ml-auto text-[11px]">
          {active.length ? `${active.length} on cool-down` : 'None'}
        </span>
      </div>
      <p className="text-fg-dim mt-1 text-[11px] leading-relaxed">
        A cool-down starts only when a provider returns a rate or usage limit. Routing then prefers
        another account in the same pool until it ends. This is RunHQ&rsquo;s own backoff, not a
        reset the provider reported; these CLIs do not publish a remaining allowance, so none is
        shown or guessed. A task already running keeps its account.
      </p>
      {error && (
        <p role="alert" className="text-status-error mt-2 text-[11px]">
          {error}
        </p>
      )}
      {active.length ? (
        <ul className="mt-3 space-y-2">
          {active.map(([id, cooldown]) => (
            <li key={id} className="border-border rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <AgentProviderLogo backend={id} className="h-4 w-4" />
                <strong className="text-fg font-medium">{name(id)}</strong>
                <span className="text-fg-dim">
                  reported a limit {formatAgentDuration(now - cooldown.since) ?? '0s'} ago
                </span>
                <span className="text-fg-muted ml-auto">
                  routing resumes in {formatAgentDuration(cooldown.until - now) ?? '0s'}
                </span>
                <button
                  type="button"
                  disabled={clearing === id}
                  onClick={() => void resume(id)}
                  className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40"
                >
                  Resume now
                </button>
              </div>
              {cooldown.reason && (
                <p className="text-fg-dim mt-2 text-[11px] break-words">
                  Provider said: {cooldown.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted mt-3 text-[11px]">
          No account has reported a limit. Cool-downs appear here when one does.
        </p>
      )}
    </div>
  );
}
