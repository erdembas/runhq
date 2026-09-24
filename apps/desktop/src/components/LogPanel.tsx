import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ServiceLayout } from '@/components/layout/ServiceLayout';
import { activeCommandLogName, listGroups } from '@/components/layout/layoutModel';
import { useServiceLayout } from '@/components/layout/useServiceLayout';
import { LogPanelBodyHosts } from '@/components/log-panel/LogPanelBodyHosts';
import { LogPanelToolbar } from '@/components/log-panel/LogPanelToolbar';
import {
  useActiveServiceCommand,
  useLoadCommandLogs,
  useServiceCommandNames,
} from '@/components/log-panel/useCommandLogs';
import { useDocumentThemeFlag } from '@/components/log-panel/useDocumentThemeFlag';
import { useDocTerminalRunner } from '@/components/log-panel/useDocTerminalRunner';
import { useLogAiContextMenu } from '@/components/log-panel/useLogAiContextMenu';
import { useLogPanelSlots } from '@/components/log-panel/useLogPanelSlots';
import { usePendingBodyTabRequest } from '@/components/log-panel/usePendingBodyTabRequest';
import { useRunningCommandFocus } from '@/components/log-panel/useRunningCommandFocus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { registerServiceShortcuts } from '@/lib/serviceShortcutBus';
import { openProjectSection } from '@/lib/workbenchNavigation';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';

const ProjectDocsTab = lazy(() =>
  import('@/components/docs/ProjectDocsTab').then((m) => ({ default: m.ProjectDocsTab })),
);
const ProjectNotesTab = lazy(() =>
  import('@/components/ProjectNotesTab').then((m) => ({ default: m.ProjectNotesTab })),
);

interface LogPanelProps {
  serviceId: string;
  isActive: boolean;
  workbenchSection?: 'run' | 'docs' | 'notes';
}

/** One persistent owner for the project's logs, document state, and PTYs. */
export function LogPanel({ serviceId, isActive, workbenchSection = 'run' }: LogPanelProps) {
  i18n.useLocale();
  const service = useAppStore((s) => s.services.find((x) => x.id === serviceId) ?? null);
  const status = useAppStore((s) => s.statuses[serviceId]);
  const ports = useAppStore((s) => s.ports);
  const clearLogsLocal = useAppStore((s) => s.clearLogs);
  const requestedCommand = useAppStore((s) =>
    s.selectedServiceId === serviceId ? s.selectedCmdName : null,
  );
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [portsOpen, setPortsOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const visited = useRef(new Set<string>());
  visited.current.add(workbenchSection);
  const runActive = isActive && workbenchSection === 'run';
  const commandNames = useServiceCommandNames(service);
  const layout = useServiceLayout(serviceId, commandNames);
  const visibleTabIds = useMemo(
    () =>
      new Set(
        listGroups(layout.state.root).flatMap((group) => {
          const visible = group.tabs.filter(
            (id) =>
              layout.state.tabs[id] &&
              (layout.state.tabs[id]!.kind !== 'docs' || layout.state.includeDocs),
          );
          const active =
            group.activeTab && visible.includes(group.activeTab) ? group.activeTab : visible[0];
          return active ? [active] : [];
        }),
      ),
    [layout.state],
  );
  const { bodySlots, onSlotRef } = useLogPanelSlots();
  const isDark = useDocumentThemeFlag();
  const activeLogCmd = useMemo(() => activeCommandLogName(layout.state), [layout.state]);
  const activeCmd = useActiveServiceCommand(service, activeLogCmd);
  useLoadCommandLogs(serviceId, commandNames);
  const handleLineContextMenu = useLogAiContextMenu({ service });
  const docRunner = useDocTerminalRunner({ serviceId, layout });
  usePendingBodyTabRequest({ serviceId, activeCommandName: activeCmd, layout });
  useRunningCommandFocus({ commands: status?.commands ?? [], layout });
  useEffect(() => {
    if (!isActive || !requestedCommand) return;
    layout.openCommandLog(requestedCommand);
    useAppStore.getState().setSelectedCmd(null);
  }, [isActive, requestedCommand, layout]);

  useEffect(
    () =>
      registerServiceShortcuts(serviceId, {
        newTerminal: () => {
          layout.addTerminal();
          openProjectSection(serviceId, 'run');
        },
      }),
    [serviceId, layout],
  );

  const currentStatus = status?.status ?? 'stopped';
  const isServiceRunning = currentStatus === 'running' || currentStatus === 'starting';
  useEffect(() => {
    if (!runActive || !isServiceRunning) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey &&
        event.key === 'c' &&
        !target?.closest('input, textarea, [contenteditable="true"], .xterm')
      ) {
        event.preventDefault();
        setConfirmStop(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runActive, isServiceRunning]);

  if (!service) return <div className="text-fg-dim p-5">{i18n.t('Loading service…')}</div>;
  const pids = new Set(
    [status?.pid, ...(status?.commands ?? []).map((c) => c.pid)].filter(
      (pid): pid is number => pid != null,
    ),
  );
  const servicePorts = ports.filter(
    (p) =>
      pids.has(p.pid) ||
      (p.ancestor_pids ?? []).some((pid) => pids.has(pid)) ||
      service.port === p.port,
  );
  return (
    <div className="bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {docRunner.error && (
        <p role="alert" className="text-status-error border-border border-b px-4 py-2 text-xs">
          {i18n.t('Could not run documentation command: {message}', { message: docRunner.error })}
        </p>
      )}
      <div
        className={workbenchSection === 'run' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
        aria-hidden={workbenchSection !== 'run'}
      >
        <div className="border-border/70 shrink-0 border-b px-4 py-2">
          <LogPanelToolbar
            activeCmd={activeLogCmd}
            cmdStatuses={status?.commands ?? []}
            filter={filter}
            isServiceRunning={isServiceRunning}
            openPortsPopover={portsOpen}
            ports={servicePorts}
            service={service}
            servicePid={status?.pid ?? null}
            onOpenPopoverChange={setPortsOpen}
            onSetFilter={setFilter}
            onStart={() => void ipc.startService(service.id)}
            onRestart={() => void ipc.restartService(service.id)}
            onStop={() => void ipc.stopService(service.id)}
            onSelectCommand={layout.openCommandLog}
          />
        </div>
        <ServiceLayout
          layout={layout}
          onSlotRef={onSlotRef}
          onAddTerminalToEmpty={(groupId) => layout.addTerminal(groupId)}
        />
      </div>
      <LogPanelBodyHosts
        tabs={layout.state.tabs}
        isActive={runActive}
        visibleTabIds={visibleTabIds}
        bodySlots={bodySlots}
        selectedId={serviceId}
        cwd={service.cwd}
        commands={service.cmds}
        filter={filter}
        showTimestamp={showTimestamp}
        setShowTimestamp={setShowTimestamp}
        follow={follow}
        setFollow={setFollow}
        isDark={isDark}
        handleLineContextMenu={handleLineContextMenu}
        clearLogsLocal={clearLogsLocal}
        onTerminalReady={docRunner.terminalReady}
        onTerminalClosed={docRunner.terminalClosed}
      />
      {visited.current.has('docs') && (
        <div
          className={workbenchSection === 'docs' ? 'flex min-h-0 flex-1' : 'hidden'}
          aria-hidden={workbenchSection !== 'docs'}
        >
          <Suspense fallback={<div className="text-fg-dim p-5">{i18n.t('Loading docs…')}</div>}>
            <ProjectDocsTab
              serviceId={serviceId}
              cwd={service.cwd}
              onRunCommand={docRunner.runCommand}
            />
          </Suspense>
        </div>
      )}
      {visited.current.has('notes') && (
        <div
          className={workbenchSection === 'notes' ? 'flex min-h-0 flex-1' : 'hidden'}
          aria-hidden={workbenchSection !== 'notes'}
        >
          <Suspense fallback={<div className="text-fg-dim p-5">{i18n.t('Loading notes…')}</div>}>
            <ProjectNotesTab serviceId={serviceId} serviceName={service.name} />
          </Suspense>
        </div>
      )}
      {runActive && confirmStop && (
        <ConfirmDialog
          message={
            activeCmd
              ? i18n.t('Stop "{activeCmd}" command on {value2}?', {
                  activeCmd,
                  value2: service.name,
                })
              : i18n.t('Stop {value1}?', { value1: service.name })
          }
          onCancel={() => setConfirmStop(false)}
          onConfirm={() => {
            setConfirmStop(false);
            if (activeCmd) void ipc.stopServiceCmd(serviceId, activeCmd);
            else void ipc.stopService(serviceId);
          }}
        />
      )}
    </div>
  );
}
