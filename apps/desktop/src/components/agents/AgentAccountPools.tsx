import { useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { useVisibleStore } from '@/lib/useVisibleStore';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentLibraryStore } from '@/store/useAgentLibraryStore';
import { MAX_POOL_ACCOUNTS, parseAccountPool, type AgentAccountPool } from './agentAccountRouting';

const field =
  'border-fg/10 bg-fg/3 text-fg focus:border-fg/25 w-full rounded-xl border px-3 py-2 text-[12px]';

/**
 * Group interchangeable accounts so a task can target the group instead of one identity. Grouping
 * is the user's claim that these accounts are substitutable; RunHQ never infers it from a shared
 * adapter, because two connections for the same product may well be different people's.
 */
export function AgentAccountPools({ visible = true }: { visible?: boolean }) {
  const tools = useVisibleStore(useAgentStore, (state) => state.tools, visible);
  const records = useVisibleStore(useAgentLibraryStore, (state) => state.records, visible);
  const ready = useVisibleStore(useAgentLibraryStore, (state) => state.ready, visible);
  const [draft, setDraft] = useState<AgentAccountPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible && !ready) void useAgentLibraryStore.getState().refresh();
  }, [visible, ready]);
  const pools = useMemo(() => {
    const parsed: AgentAccountPool[] = [];
    for (const [key, record] of Object.entries(records)) {
      if (!key.startsWith('pool:')) continue;
      try {
        parsed.push(parseAccountPool(record.value));
      } catch {
        // A record RunHQ cannot read is left alone rather than shown as an empty pool.
      }
    }
    return parsed.sort((left, right) => left.name.localeCompare(right.name));
  }, [records]);
  const name = (id: string) => tools.find((tool) => tool.id === id)?.name ?? id;
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            accounts: current.accounts.includes(id)
              ? current.accounts.filter((account) => account !== id)
              : [...current.accounts, id].slice(0, MAX_POOL_ACCOUNTS),
          }
        : current,
    );
  return (
    <section aria-label="Account pools" className="border-fg/8 mt-4 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="text-accent h-4 w-4" />
        <h3 className="text-fg text-[12px] font-medium">Account pools</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDraft({ id: `pool-${crypto.randomUUID()}`, name: '', accounts: [] })}
          className="hover:bg-fg/5 ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
        >
          <Plus className="h-3 w-3" />
          New pool
        </button>
      </div>
      <p className="text-fg-dim mt-1 text-[10px] leading-relaxed">
        A pool is a set of accounts you consider interchangeable. A task aimed at a pool starts on
        one of them and keeps it for the whole session. The choice uses the connection&rsquo;s
        declared capabilities, any cool-down after a reported limit, and which account has a free
        execution slot &mdash; never a guess at remaining quota.
      </p>
      {error && (
        <p role="alert" className="text-status-error mt-2 text-[11px]">
          {error}
        </p>
      )}
      {draft ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const pool = parseAccountPool(draft);
              await useAgentLibraryStore.getState().save(`pool:${pool.id}`, pool);
              setDraft(null);
            });
          }}
        >
          <label className="text-fg-muted text-[11px]">
            Pool name
            <input
              className={field}
              value={draft.name}
              autoFocus
              placeholder="Claude accounts"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-fg-muted text-[11px]">Accounts in this pool</legend>
            {tools.map((tool) => (
              <label key={tool.id} className="text-fg-muted flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.accounts.includes(tool.id)}
                  onChange={() => toggle(tool.id)}
                />
                <span className="truncate">{tool.name}</span>
                {tool.enabled === false && <span className="text-fg-dim">· disabled</span>}
                {!tool.available && <span className="text-fg-dim">· not installed</span>}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="hover:bg-fg/5 rounded-lg px-2 py-1 text-[11px]"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              className="bg-fg text-surface rounded-lg px-3 py-1 text-[11px] disabled:opacity-40"
              disabled={busy}
            >
              Save pool
            </button>
          </div>
        </form>
      ) : pools.length ? (
        <ul className="mt-3 space-y-2">
          {pools.map((pool) => (
            <li key={pool.id} className="border-fg/8 rounded-lg border p-2">
              {/* The actions stay on the title row; the member list is what may run long. */}
              <div className="flex items-center gap-2 text-[11px]">
                <strong className="text-fg min-w-0 flex-1 truncate font-medium">{pool.name}</strong>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDraft(pool)}
                  className="hover:bg-fg/5 shrink-0 rounded-lg px-2 py-1"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${pool.name}`}
                  disabled={busy}
                  onClick={() =>
                    void act(() => useAgentLibraryStore.getState().save(`pool:${pool.id}`, null))
                  }
                  className="hover:bg-fg/5 shrink-0 rounded-lg px-2 py-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <p className="text-fg-dim mt-1 text-[10px]">{pool.accounts.map(name).join(', ')}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted mt-3 text-[11px]">
          No pools yet. Add one once you have a second account for the same product.
        </p>
      )}
    </section>
  );
}
