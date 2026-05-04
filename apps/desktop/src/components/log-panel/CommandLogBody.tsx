import { Eraser } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { LogXtermView } from '@/components/LogXtermView';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { logKey } from '@/store/useAppStore';
import type { CommandEntry } from '@/types';
import { EMPTY_LOGS, badgeClass, filterLogLines } from './model';
import type { LogsByCommand } from './useCommandLogs';

interface CommandLogBodyProps {
  allLogsByCommand: LogsByCommand;
  clearLogsLocal: (key: string) => void;
  commands: CommandEntry[];
  filter: string;
  follow: boolean;
  isDark: boolean;
  onLineContextMenu: (commandName: string, index: number) => void;
  selectedId: string;
  setFollow: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  showTimestamp: boolean;
  tab: LayoutTab;
}

export function CommandLogBody({
  allLogsByCommand,
  clearLogsLocal,
  commands,
  filter,
  follow,
  isDark,
  onLineContextMenu,
  selectedId,
  setFollow,
  setShowTimestamp,
  showTimestamp,
  tab,
}: CommandLogBodyProps) {
  const commandName = tab.commandName ?? commands[0]?.name ?? null;
  const commandEntry = commandName
    ? (commands.find((command) => command.name === commandName) ?? null)
    : null;
  const allLogs = commandName ? (allLogsByCommand[commandName] ?? EMPTY_LOGS) : EMPTY_LOGS;
  const filtered = filterLogLines(allLogs, filter);
  const key = commandName ? logKey(selectedId, commandName) : '';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="text-fg-dim flex items-center justify-between gap-3 px-5 py-1.5 text-[10.5px]">
        <div className="flex min-w-0 items-center gap-2">
          {commandName && (
            <span className={cn('svc-badge shrink-0', badgeClass(commandName))}>{commandName}</span>
          )}
          {commandEntry && (
            <code className="text-fg-muted truncate font-mono text-[11px]" title={commandEntry.cmd}>
              {commandEntry.cmd}
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
              if (key) {
                void ipc.clearLogs(key);
                clearLogsLocal(key);
              }
            }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-6">
        <LogXtermView
          key={`${selectedId}::${commandName ?? '__none__'}`}
          serviceId={selectedId}
          commandName={commandName}
          lines={filtered}
          totalLogs={allLogs.length}
          showTimestamp={showTimestamp}
          follow={follow}
          isDark={isDark}
          onLineContextMenu={(index) => {
            if (commandName) onLineContextMenu(commandName, index);
          }}
        />
      </div>
    </div>
  );
}
