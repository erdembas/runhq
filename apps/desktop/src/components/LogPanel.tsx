import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import { ServiceLayout } from '@/components/layout/ServiceLayout';
import { findGroupByTab } from '@/components/layout/layoutModel';
import { useServiceLayout } from '@/components/layout/useServiceLayout';
import { LogPanelBodyHosts } from '@/components/log-panel/LogPanelBodyHosts';
import { LogPanelHeader } from '@/components/log-panel/LogPanelHeader';
import { LogPanelOverlays } from '@/components/log-panel/LogPanelOverlays';
import { EMPTY_LOGS, utf8ToBytes } from '@/components/log-panel/model';
import { useDocumentThemeFlag } from '@/components/log-panel/useDocumentThemeFlag';
import { useLogPanelSlots } from '@/components/log-panel/useLogPanelSlots';
import { useProjectDocsDiscovery } from '@/components/log-panel/useProjectDocsDiscovery';
import { useRunningCommandFocus } from '@/components/log-panel/useRunningCommandFocus';
import { registerServiceShortcuts } from '@/lib/serviceShortcutBus';
import { useAppStore, logKey } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { localUrl } from '@/lib/url';
import { runtimeFromTags, inferRuntimeFromCmds } from '@/lib/runtimes';
import { buildLogChatPayload } from '@/lib/ai/logPayload';

type PopoverKey = 'ports';

interface LogPanelProps {
  serviceId: string;
}

export function LogPanel({ serviceId }: LogPanelProps) {
  const selectedId = serviceId;
  const [selectedCmdName, setSelectedCmdName] = useState<string | null>(null);
  const service = useAppStore((s) => s.services.find((x) => x.id === serviceId) ?? null);
  const status = useAppStore((s) => s.statuses[serviceId]);
  const ports = useAppStore((s) => s.ports);
  const replaceLogs = useAppStore((s) => s.replaceLogs);
  const clearLogsLocal = useAppStore((s) => s.clearLogs);
  const openEditor = useAppStore((s) => s.openEditor);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const upsertService = useAppStore((s) => s.upsertService);
  const openAiChat = useAppStore((s) => s.openAiChat);

  const projectMeta = useAppStore(
    (s) => s.overview?.projects.find((p) => p.service_id === serviceId) ?? null,
  );

  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const overviewScanning = useAppStore((s) => s.overviewScanning);
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const setOverviewScanning = useAppStore((s) => s.setOverviewScanning);
  const patchOverviewScan = useAppStore((s) => s.patchOverviewScan);
  const editors = useAppStore((s) => s.editors);
  const pendingBodyTabRequest = useAppStore((s) => s.pendingServiceBodyTab[serviceId]);
  const consumePendingBodyTab = useAppStore((s) => s.consumePendingServiceBodyTab);
  const runWorkspaceScan = useCallback(async () => {
    if (overviewScanning) return;
    setOverviewScanning(true);
    try {
      const result = await ipc.scanProjectDependencies(true);
      patchOverviewScan(result);
    } catch (err) {
      console.error('scan_project_dependencies failed', err);
    } finally {
      setOverviewScanning(false);
    }
  }, [overviewScanning, setOverviewScanning, patchOverviewScan]);

  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [openPopover, setOpenPopover] = useState<PopoverKey | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const layout = useServiceLayout(serviceId);
  const { bodySlots, onSlotRef } = useLogPanelSlots();

  const isDark = useDocumentThemeFlag();

  const activeCmd = useMemo(() => {
    if (!service) return null;
    if (selectedCmdName && service.cmds.some((c) => c.name === selectedCmdName))
      return selectedCmdName;
    return service.cmds[0]?.name ?? null;
  }, [service, selectedCmdName]);

  const activeCmdEntry = useMemo(() => {
    if (!service || !activeCmd) return null;
    return service.cmds.find((c) => c.name === activeCmd) ?? null;
  }, [service, activeCmd]);

  const logK = activeCmd && selectedId ? logKey(selectedId, activeCmd) : '';
  const logs = useAppStore((s) => (logK ? (s.logs[logK]?.lines ?? EMPTY_LOGS) : EMPTY_LOGS));

  useProjectDocsDiscovery({ selectedId, activeCmd, layout });

  useEffect(() => {
    if (!selectedId || !activeCmd) return;
    let alive = true;
    const key = logKey(selectedId, activeCmd);
    (async () => {
      try {
        const lines = await ipc.getLogs(key, 0);
        if (alive) replaceLogs(key, lines);
      } catch (err) {
        console.error('get_logs failed', err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId, activeCmd, replaceLogs]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return logs;
    const q = filter.toLowerCase();
    return logs.filter((l) => l.text.toLowerCase().includes(q));
  }, [logs, filter]);

  const handleLineContextMenu = useCallback(
    (index: number) => {
      const target = filtered[index];
      if (!target) return;
      const start = Math.max(0, index - 30);
      const ctx = filtered.slice(start, index + 1).map((l) => l.text);
      const runtime = service
        ? (runtimeFromTags(service.tags) ?? inferRuntimeFromCmds(service.cmds))
        : null;
      const payload = buildLogChatPayload({
        line: target.text,
        contextLines: ctx,
        runtime,
        serviceName: service?.name ?? null,
      });
      void openAiChat({
        origin: 'log',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
        autoSend: true,
      });
    },
    [filtered, service, openAiChat],
  );

  const activateSingleton = useCallback(
    (tabId: 'logs' | 'docs' | 'notes') => {
      const group = findGroupByTab(layout.state.root, tabId);
      if (group) layout.activate(group.id, tabId);
    },
    [layout],
  );

  useEffect(() => {
    if (!pendingBodyTabRequest) return;
    if (pendingBodyTabRequest === 'terminal') {
      layout.ensureTerminal();
    } else if (
      pendingBodyTabRequest === 'logs' ||
      pendingBodyTabRequest === 'docs' ||
      pendingBodyTabRequest === 'notes'
    ) {
      activateSingleton(pendingBodyTabRequest);
    }
    consumePendingBodyTab(serviceId);
  }, [pendingBodyTabRequest, consumePendingBodyTab, serviceId, layout, activateSingleton]);

  useEffect(() => {
    if (!serviceId) return;
    return registerServiceShortcuts(serviceId, {
      newTerminal: () => {
        layout.ensureTerminal();
      },
    });
  }, [serviceId, layout]);

  const runDocCommand = useCallback(
    (command: string) => {
      if (!selectedId) return;
      const targetId = layout.ensureTerminal();
      if (!targetId) return;
      window.setTimeout(() => {
        const bytes = utf8ToBytes(`${command}\r`);
        void ipc.terminalWrite(targetId, bytes).catch((err) => {
          console.warn('docs: terminal_write failed', err);
        });
      }, 250);
    },
    [selectedId, layout],
  );

  useRunningCommandFocus({
    commands: status?.commands ?? [],
    layout,
    setSelectedCmdName,
  });

  const currentStatus = status?.status ?? 'stopped';
  const isServiceRunning = currentStatus === 'running' || currentStatus === 'starting';
  const cmdStatuses = status?.commands ?? [];

  useEffect(() => {
    if (!isServiceRunning || !service || !selectedId) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.key === 'c' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        const msg = activeCmd
          ? `Stop "${activeCmd}" command on ${service.name}?`
          : `Stop ${service.name}?`;
        setPendingConfirm({
          message: msg,
          onConfirm: () => {
            setPendingConfirm(null);
            if (activeCmd) void ipc.stopServiceCmd(selectedId, activeCmd);
            else void ipc.stopService(selectedId);
          },
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isServiceRunning, selectedId, activeCmd, service]);

  if (!service || !selectedId) {
    return (
      <div className="text-fg-dim flex flex-1 items-center justify-center text-[13px]">
        {!selectedId ? 'Select a service to view its logs.' : 'Loading service…'}
      </div>
    );
  }

  const supervisedPids = new Set<number>();
  if (status?.pid != null) supervisedPids.add(status.pid);
  for (const c of status?.commands ?? []) {
    if (c.pid != null) supervisedPids.add(c.pid);
  }

  const servicePorts = ports.filter((p) => {
    if (supervisedPids.has(p.pid)) return true;
    for (const anc of p.ancestor_pids ?? []) {
      if (supervisedPids.has(anc)) return true;
    }
    return service.port != null && p.port === service.port;
  });

  return (
    <div className="bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <LogPanelHeader
        activeCmd={activeCmd}
        cmdStatuses={cmdStatuses}
        currentStatus={currentStatus}
        filter={filter}
        isServiceRunning={isServiceRunning}
        openPortsPopover={openPopover === 'ports'}
        ports={servicePorts}
        projectMeta={projectMeta}
        service={service}
        servicePid={status?.pid ?? null}
        onOpenDetail={setDetailTab}
        onLicenseOpen={() => setLicenseOpen(true)}
        onEdit={() => openEditor(service)}
        onDelete={() => {
          setPendingConfirm({
            message: `Delete "${service.name}"?`,
            onConfirm: async () => {
              setPendingConfirm(null);
              await ipc.stopService(service.id).catch(() => undefined);
              await ipc.removeService(service.id);
              removeServiceLocal(service.id);
            },
          });
        }}
        onOpenFolder={() => void ipc.openPath(service.cwd)}
        onOpenPort={(port) => void ipc.openUrl(localUrl(port))}
        onHideToggle={() => {
          const next = { ...service, hide_dashboard: !service.hide_dashboard };
          upsertService(next);
          void ipc
            .updateService(next)
            .then((saved) => upsertService(saved))
            .catch((err) => {
              console.warn('updateService(hide_dashboard) failed', err);
              upsertService(service);
            });
        }}
        onOpenPopoverChange={(open) => setOpenPopover(open ? 'ports' : null)}
        onSetFilter={setFilter}
        onStart={() => void ipc.startService(service.id)}
        onRestart={() => void ipc.restartService(service.id)}
        onStop={() => void ipc.stopService(service.id)}
        onSelectCommand={setSelectedCmdName}
      />

      <ServiceLayout
        layout={layout}
        onSlotRef={onSlotRef}
        onAddTerminalToEmpty={(groupId) => layout.addTerminal(groupId)}
      />

      <LogPanelBodyHosts
        tabs={layout.state.tabs}
        bodySlots={bodySlots}
        selectedId={selectedId}
        cwd={service.cwd}
        serviceName={service.name}
        activeCmd={activeCmd}
        activeCmdEntry={activeCmdEntry}
        filtered={filtered}
        allLogs={logs}
        logK={logK}
        showTimestamp={showTimestamp}
        setShowTimestamp={setShowTimestamp}
        follow={follow}
        setFollow={setFollow}
        isDark={isDark}
        handleLineContextMenu={handleLineContextMenu}
        clearLogsLocal={clearLogsLocal}
        onRunCommand={runDocCommand}
      />
      <LogPanelOverlays
        detailTab={detailTab}
        editors={editors}
        lastScanAt={lastScanAt}
        licenseOpen={licenseOpen}
        overviewScanning={overviewScanning}
        pendingConfirm={pendingConfirm}
        projectMeta={projectMeta}
        service={service}
        onCloseDetail={() => setDetailTab(null)}
        onCloseLicense={() => setLicenseOpen(false)}
        onCancelConfirm={() => setPendingConfirm(null)}
        onRescan={() => void runWorkspaceScan()}
      />
    </div>
  );
}
