import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ExternalLink, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import type { ListeningPort } from '@/types';

interface Props {
  onClose: () => void;
}

interface PortRow {
  port: ListeningPort;
  owner: { id: string; name: string } | null;
}

export function PortManager({ onClose }: Props) {
  i18n.useLocale();
  const ports = useAppStore((s) => s.ports);
  const setPorts = useAppStore((s) => s.setPorts);
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);

  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const pidOwner = useMemo(() => {
    const map = new Map<number, { id: string; name: string }>();
    for (const svc of services) {
      const st = statuses[svc.id];
      if (!st) continue;
      const isRunning = st.status === 'running' || st.status === 'starting';
      if (!isRunning) continue;
      const owner = { id: svc.id, name: svc.name };
      if (st.pid != null) map.set(st.pid, owner);
      for (const c of st.commands ?? []) {
        if (c.pid != null) map.set(c.pid, owner);
      }
    }
    return map;
  }, [services, statuses]);

  const ownerOf = useCallback(
    (p: ListeningPort) => {
      const direct = pidOwner.get(p.pid);
      if (direct) return direct;
      for (const anc of p.ancestor_pids ?? []) {
        const hit = pidOwner.get(anc);
        if (hit) return hit;
      }
      for (const svc of services) {
        if (svc.port == null || svc.port !== p.port) continue;
        const st = statuses[svc.id];
        if (st?.status !== 'running' && st?.status !== 'starting') continue;
        return { id: svc.id, name: svc.name };
      }
      return null;
    },
    [pidOwner, services, statuses],
  );

  const classified = useMemo<PortRow[]>(
    () => ports.map((p) => ({ port: p, owner: ownerOf(p) })),
    [ports, ownerOf],
  );

  const appPorts = useMemo(() => classified.filter((r) => r.owner != null), [classified]);
  const systemPorts = useMemo(() => classified.filter((r) => r.owner == null), [classified]);

  const q = search.trim().toLowerCase();

  const filteredApp = useMemo(() => {
    if (!q) return appPorts;
    return appPorts.filter(({ port: p, owner }) => {
      if (p.port.toString().includes(q)) return true;
      if (p.process_name.toLowerCase().includes(q)) return true;
      if (p.pid.toString().includes(q)) return true;
      if (owner?.name.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [appPorts, q]);

  const filteredSystem = useMemo(() => {
    if (!q) return systemPorts;
    return systemPorts.filter(({ port: p }) => {
      if (p.port.toString().includes(q)) return true;
      if (p.process_name.toLowerCase().includes(q)) return true;
      if (p.pid.toString().includes(q)) return true;
      return false;
    });
  }, [systemPorts, q]);

  const handleKill = (port: number) => {
    setPendingConfirm({
      message: i18n.t('Kill all processes on port {port}?', { port: port }),
      onConfirm: async () => {
        setPendingConfirm(null);
        setBusy(port);
        try {
          await ipc.killPort(port);
          const refreshed = await ipc.listPorts();
          setPorts(refreshed);
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const totalApp = appPorts.length;
  const totalSystem = systemPorts.length;

  return (
    <Dialog
      title={i18n.t('Port Manager')}
      subtitle={i18n.t('{totalApp} app · {totalSystem} system', {
        totalApp: totalApp,
        totalSystem: totalSystem,
      })}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="text-fg-dim absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={i18n.t('Search by port, process, service, or PID…')}
            className="border-border bg-surface-raised text-fg placeholder:text-fg-dim focus:border-accent rounded-app-sm h-7 w-full border pr-2 pl-7 text-[11px] transition focus:outline-none"
          />
        </div>

        <Section
          title={i18n.t('App Ports')}
          count={totalApp}
          rows={filteredApp}
          busy={busy}
          onKill={handleKill}
          emptyMessage={i18n.t('No ports from your running services.')}
          emptyHint={i18n.t('Start a service that binds a port to see it here.')}
        />

        <Section
          title={i18n.t('System Ports')}
          count={totalSystem}
          rows={filteredSystem}
          busy={busy}
          onKill={handleKill}
          emptyMessage={i18n.t('No other listening ports detected.')}
          emptyHint={i18n.t('Ports bound by processes outside RunHQ appear here.')}
        />
      </div>
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </Dialog>
  );
}

function Section({
  title,
  count,
  rows,
  busy,
  onKill,
  emptyMessage,
  emptyHint,
}: {
  title: string;
  count: number;
  rows: PortRow[];
  busy: number | null;
  onKill: (port: number) => void;
  emptyMessage: string;
  emptyHint: string;
}) {
  i18n.useLocale();
  return (
    <div>
      <div className="text-fg-dim mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase">
        <span>{title}</span>
        <span className="text-fg-dim/70 tabular-nums">{count}</span>
      </div>
      {rows.length === 0 ? (
        <div className="border-border rounded-app-sm border px-3 py-6 text-center">
          <p className="text-fg-dim text-[11px]">{emptyMessage}</p>
          <p className="text-fg-dim/60 mt-1 text-[10px]">{emptyHint}</p>
        </div>
      ) : (
        <div className="border-border rounded-app-sm overflow-hidden border">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="bg-surface-muted/70 text-fg-dim border-border border-b text-[9px] font-semibold tracking-wider uppercase">
                <th className="px-2.5 py-1.5">{i18n.t('Port')}</th>
                <th className="px-2.5 py-1.5">{i18n.t('PID')}</th>
                <th className="px-2.5 py-1.5">{i18n.t('Process')}</th>
                <th className="px-2.5 py-1.5">{i18n.t('Service')}</th>
                <th className="w-[1%] px-2.5 py-1.5 text-right">
                  <span className="sr-only">{i18n.t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ port: p, owner }) => {
                const isBusy = busy === p.port;
                return (
                  <tr
                    key={`${p.port}-${p.pid}`}
                    className="group border-border/70 hover:bg-surface-raised/40 border-t transition last:border-t-0"
                  >
                    <td className="px-2.5 py-1.5">
                      <span className="text-accent font-semibold tabular-nums">:{p.port}</span>
                    </td>
                    <td className="text-fg-dim px-2.5 py-1.5 tabular-nums">{p.pid}</td>
                    <td className="px-2.5 py-1.5">
                      <span className="text-fg-muted max-w-[220px] truncate">{p.process_name}</span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      {owner ? (
                        <span className="bg-accent/10 text-accent rounded-app-sm px-1.5 py-0.5 text-[9px] font-medium">
                          {owner.name}
                        </span>
                      ) : (
                        <span className="text-fg-dim">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          title={i18n.t('Open in browser')}
                          className="text-fg-dim hover:bg-accent/10 hover:text-accent rounded-app-sm inline-flex h-5 w-5 items-center justify-center transition"
                          onClick={() => void ipc.openUrl(localUrl(p.port))}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          title={i18n.t('Kill port')}
                          className={cn(
                            'rounded-app-sm inline-flex h-5 w-5 items-center justify-center transition',
                            isBusy
                              ? 'text-fg-dim opacity-50'
                              : 'text-fg-dim hover:bg-status-error/10 hover:text-status-error',
                          )}
                          onClick={() => void onKill(p.port)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
