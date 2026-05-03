import { TabBodyHost } from './TabBodyHost';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import type { LogLine } from '@/types';

interface LogPanelBodyHostsProps {
  tabs: Record<string, LayoutTab>;
  bodySlots: Map<string, HTMLDivElement>;
  selectedId: string;
  cwd: string;
  serviceName: string;
  activeCmd: string | null;
  activeCmdEntry: { name: string; cmd: string } | null;
  filtered: LogLine[];
  allLogs: LogLine[];
  logK: string;
  showTimestamp: boolean;
  setShowTimestamp: (value: boolean) => void;
  follow: boolean;
  setFollow: (value: boolean) => void;
  isDark: boolean;
  handleLineContextMenu: (index: number) => void;
  clearLogsLocal: (key: string) => void;
  onRunCommand: (command: string) => void;
}

export function LogPanelBodyHosts({
  tabs,
  bodySlots,
  selectedId,
  cwd,
  serviceName,
  activeCmd,
  activeCmdEntry,
  filtered,
  allLogs,
  logK,
  showTimestamp,
  setShowTimestamp,
  follow,
  setFollow,
  isDark,
  handleLineContextMenu,
  clearLogsLocal,
  onRunCommand,
}: LogPanelBodyHostsProps) {
  return (
    <>
      {Object.values(tabs).map((tab) => {
        const slot = bodySlots.get(tab.id);
        if (!slot) return null;
        return (
          <TabBodyHost
            key={tab.id}
            tab={tab}
            slot={slot}
            selectedId={selectedId}
            cwd={cwd}
            serviceName={serviceName}
            activeCmd={activeCmd}
            activeCmdEntry={activeCmdEntry}
            filtered={filtered}
            allLogs={allLogs}
            logK={logK}
            showTimestamp={showTimestamp}
            setShowTimestamp={setShowTimestamp}
            follow={follow}
            setFollow={setFollow}
            isDark={isDark}
            handleLineContextMenu={handleLineContextMenu}
            clearLogsLocal={clearLogsLocal}
            onRunCommand={onRunCommand}
          />
        );
      })}
    </>
  );
}
