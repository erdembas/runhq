import { lazy, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Eraser } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { LogXtermView } from '@/components/LogXtermView';
import { TerminalPane } from '@/components/TerminalPane';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type { LogLine } from '@/types';
import { badgeClass } from './model';

const ProjectDocsTab = lazy(() =>
  import('@/components/docs/ProjectDocsTab').then((module) => ({ default: module.ProjectDocsTab })),
);

const ProjectNotesTab = lazy(() =>
  import('@/components/ProjectNotesTab').then((module) => ({ default: module.ProjectNotesTab })),
);

interface TabBodyHostProps {
  activeCmd: string | null;
  activeCmdEntry: { name: string; cmd: string } | null;
  allLogs: LogLine[];
  clearLogsLocal: (key: string) => void;
  cwd: string;
  filtered: LogLine[];
  follow: boolean;
  handleLineContextMenu: (index: number) => void;
  isDark: boolean;
  logK: string;
  onRunCommand: (command: string) => void;
  selectedId: string;
  serviceName: string;
  setFollow: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  showTimestamp: boolean;
  slot: HTMLDivElement;
  tab: LayoutTab;
}

export function TabBodyHost({
  activeCmd,
  activeCmdEntry,
  allLogs,
  clearLogsLocal,
  cwd,
  filtered,
  follow,
  handleLineContextMenu,
  isDark,
  logK,
  onRunCommand,
  selectedId,
  serviceName,
  setFollow,
  setShowTimestamp,
  showTimestamp,
  slot,
  tab,
}: TabBodyHostProps) {
  let body: ReactNode = null;
  switch (tab.kind) {
    case 'logs':
      body = (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="text-fg-dim flex items-center justify-between gap-3 px-5 py-1.5 text-[10.5px]">
            <div className="flex min-w-0 items-center gap-2">
              {activeCmd && (
                <span className={cn('svc-badge shrink-0', badgeClass(activeCmd))}>{activeCmd}</span>
              )}
              {activeCmdEntry && (
                <code
                  className="text-fg-muted truncate font-mono text-[11px]"
                  title={activeCmdEntry.cmd}
                >
                  {activeCmdEntry.cmd}
                </code>
              )}
              <span className="text-fg-dim/80 shrink-0 tabular-nums">
                · {filtered.length.toLocaleString()} / {allLogs.length.toLocaleString()} lines
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={showTimestamp}
                  onChange={(event) => setShowTimestamp(event.target.checked)}
                  className="accent-accent h-2.5 w-2.5"
                />
                Timestamp
              </label>
              <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                  className="accent-accent h-2.5 w-2.5"
                />
                Follow
              </label>
              <IconButton
                label="Clear logs"
                icon={<Eraser />}
                size="xs"
                onClick={() => {
                  if (logK) {
                    void ipc.clearLogs(logK);
                    clearLogsLocal(logK);
                  }
                }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-hidden px-6">
            <LogXtermView
              key={`${selectedId}::${activeCmd ?? '__none__'}`}
              lines={filtered}
              totalLogs={allLogs.length}
              showTimestamp={showTimestamp}
              follow={follow}
              isDark={isDark}
              onLineContextMenu={handleLineContextMenu}
            />
          </div>
        </div>
      );
      break;
    case 'docs':
      body = (
        <Suspense
          fallback={
            <div className="text-fg-dim flex flex-1 items-center justify-center text-[12.5px]">
              Loading docs…
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
              Loading notes…
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
}
