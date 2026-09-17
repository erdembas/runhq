import { TabBodyHost } from './TabBodyHost';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import type { CommandEntry, LogLine } from '@/types';

interface LogPanelBodyHostsProps {
  bodySlots: Map<string, HTMLDivElement>;
  clearLogsLocal: (key: string) => void;
  commands: CommandEntry[];
  cwd: string;
  filter: string;
  follow: boolean;
  handleLineContextMenu: (lines: LogLine[], index: number) => void;
  onRunCommand: (command: string) => void;
  selectedId: string;
  serviceName: string;
  setFollow: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  showTimestamp: boolean;
  tabs: Record<string, LayoutTab>;
  isDark: boolean;
  isActive: boolean;
  visibleTabIds: Set<string>;
}

export function LogPanelBodyHosts({
  bodySlots,
  clearLogsLocal,
  commands,
  cwd,
  filter,
  follow,
  handleLineContextMenu,
  isDark,
  onRunCommand,
  selectedId,
  serviceName,
  setFollow,
  setShowTimestamp,
  showTimestamp,
  tabs,
  isActive,
  visibleTabIds,
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
            visible={isActive && visibleTabIds.has(tab.id)}
            selectedId={selectedId}
            cwd={cwd}
            serviceName={serviceName}
            commands={commands}
            filter={filter}
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
