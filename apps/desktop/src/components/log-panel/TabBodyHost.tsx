import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, memo, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TerminalPane } from '@/components/TerminalPane';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import type { CommandEntry, LogLine } from '@/types';
import { ProjectAgentsTab } from '@/components/agents/ProjectAgentsTab';
import { CommandLogBody } from './CommandLogBody';

const ProjectDocsTab = lazy(() =>
  import('@/components/docs/ProjectDocsTab').then((module) => ({ default: module.ProjectDocsTab })),
);

const ProjectNotesTab = lazy(() =>
  import('@/components/ProjectNotesTab').then((module) => ({ default: module.ProjectNotesTab })),
);

interface TabBodyHostProps {
  clearLogsLocal: (key: string) => void;
  commands: CommandEntry[];
  cwd: string;
  filter: string;
  follow: boolean;
  handleLineContextMenu: (lines: LogLine[], index: number) => void;
  isDark: boolean;
  onRunCommand: (command: string) => void;
  selectedId: string;
  serviceName: string;
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
  onRunCommand,
  selectedId,
  serviceName,
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
      body = <ProjectAgentsTab key={cwd} cwd={cwd} name={serviceName} visible={visible} />;
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
    case 'docs':
      body = (
        <Suspense
          fallback={
            <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
              {i18n.t('Loading docs…')}
            </div>
          }
        >
          <ProjectDocsTab serviceId={selectedId} cwd={cwd} onRunCommand={onRunCommand} />
        </Suspense>
      );
      break;
    case 'notes':
      body = (
        <Suspense
          fallback={
            <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
              {i18n.t('Loading notes…')}
            </div>
          }
        >
          <ProjectNotesTab serviceId={selectedId} serviceName={serviceName} />
        </Suspense>
      );
      break;
    case 'terminal':
      body = (
        <div className="bg-surface-muted relative flex min-h-0 flex-1 flex-col">
          <TerminalPane id={tab.id} cwd={cwd} />
        </div>
      );
      break;
  }

  return createPortal(body, slot);
});
