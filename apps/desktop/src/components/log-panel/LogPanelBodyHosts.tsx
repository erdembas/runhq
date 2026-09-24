import * as i18n from '@runhq/cockpit-ui/i18n';
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
  onTerminalReady: (id: string) => void;
  onTerminalClosed: (id: string) => void;
  selectedId: string;
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
  onTerminalReady,
  onTerminalClosed,
  selectedId,
  setFollow,
  setShowTimestamp,
  showTimestamp,
  tabs,
  isActive,
  visibleTabIds,
}: LogPanelBodyHostsProps) {
  i18n.useLocale();
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
            commands={commands}
            filter={filter}
            showTimestamp={showTimestamp}
            setShowTimestamp={setShowTimestamp}
            follow={follow}
            setFollow={setFollow}
            isDark={isDark}
            handleLineContextMenu={handleLineContextMenu}
            clearLogsLocal={clearLogsLocal}
            onTerminalReady={onTerminalReady}
            onTerminalClosed={onTerminalClosed}
          />
        );
      })}
    </>
  );
}
