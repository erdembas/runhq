import * as i18n from '@runhq/cockpit-ui/i18n';
import { memo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TerminalPane } from '@/components/TerminalPane';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import type { CommandEntry, LogLine } from '@/types';
import { CommandLogBody } from './CommandLogBody';
import { LegacyProjectResource } from '@/components/workbench/LegacyProjectResource';
import { projectTerminalId } from '@/components/workbench/projectTerminalModel';

interface TabBodyHostProps {
  clearLogsLocal: (key: string) => void;
  commands: CommandEntry[];
  cwd: string;
  filter: string;
  follow: boolean;
  handleLineContextMenu: (lines: LogLine[], index: number) => void;
  isDark: boolean;
  onTerminalReady: (id: string) => void;
  onTerminalClosed: (id: string) => void;
  selectedId: string;
  setFollow: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  showTimestamp: boolean;
  slot: HTMLDivElement;
  visible: boolean;
  tab: LayoutTab;
}

export const TabBodyHost = memo(function TabBodyHost({
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
  slot,
  visible,
  tab,
}: TabBodyHostProps) {
  i18n.useLocale();
  let body: ReactNode = null;
  switch (tab.kind) {
    case 'agents':
    case 'docs':
    case 'notes':
      body = <LegacyProjectResource serviceId={selectedId} kind={tab.kind} />;
      break;
    case 'logs': {
      body = (
        <CommandLogBody
          visible={visible}
          clearLogsLocal={clearLogsLocal}
          commands={commands}
          filter={filter}
          follow={follow}
          isDark={isDark}
          onLineContextMenu={handleLineContextMenu}
          selectedId={selectedId}
          setFollow={setFollow}
          setShowTimestamp={setShowTimestamp}
          showTimestamp={showTimestamp}
          tab={tab}
        />
      );
      break;
    }
    case 'terminal':
      body = (
        <div className="bg-surface-muted relative flex min-h-0 flex-1 flex-col">
          <TerminalPane
            id={projectTerminalId(selectedId, tab.id)}
            cwd={cwd}
            onReady={() => onTerminalReady(projectTerminalId(selectedId, tab.id))}
            onDispose={() => onTerminalClosed(projectTerminalId(selectedId, tab.id))}
          />
        </div>
      );
      break;
  }

  return createPortal(body, slot);
});
