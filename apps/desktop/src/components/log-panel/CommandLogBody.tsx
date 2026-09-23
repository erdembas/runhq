import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import * as i18n from '@runhq/cockpit-ui/i18n';
import { memo, useDeferredValue } from 'react';
import { Eraser } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { LogXtermView } from '@/components/LogXtermView';
import type { Tab as LayoutTab } from '@/components/layout/layoutModel';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { logKey } from '@/store/useAppStore';
import type { CommandEntry, LogLine } from '@/types';
import { badgeClass, filterLogLines } from './model';
import { useCommandLogs } from './useCommandLogs';

interface CommandLogBodyProps {
  visible: boolean;
  clearLogsLocal: (key: string) => void;
  commands: CommandEntry[];
  filter: string;
  follow: boolean;
  isDark: boolean;
  onLineContextMenu: (lines: LogLine[], index: number) => void;
  selectedId: string;
  setFollow: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  showTimestamp: boolean;
  tab: LayoutTab;
}

export const CommandLogBody = memo(function CommandLogBody({
  visible,
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
  i18n.useLocale();
  const commandName = tab.commandName ?? commands[0]?.name ?? null;
  const commandEntry = commandName
    ? (commands.find((command) => command.name === commandName) ?? null)
    : null;
  const allLogs = useCommandLogs(selectedId, commandName, visible);
  const deferredFilter = useDeferredValue(filter);
  const filtered = useMemo(
    () => filterLogLines(allLogs, deferredFilter),
    [allLogs, deferredFilter],
  );
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
            {i18n.rich('· {value1} / {value2} lines', {
              value1: filtered.length.toLocaleString(i18n.getFormatLocale()),
              value2: allLogs.length.toLocaleString(i18n.getFormatLocale()),
            })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
            {i18n.rich('{value1}Timestamp', {
              value1: (
                <input
                  type="checkbox"
                  checked={showTimestamp}
                  onChange={(event) => setShowTimestamp(event.target.checked)}
                  className="accent-accent h-2.5 w-2.5"
                />
              ),
            })}
          </label>
          <label className="text-fg-muted inline-flex cursor-pointer items-center gap-1 text-[10px]">
            {i18n.rich('{value1}Follow', {
              value1: (
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                  className="accent-accent h-2.5 w-2.5"
                />
              ),
            })}
          </label>
          <IconButton
            label={i18n.t('Clear logs')}
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
          visible={visible}
          commandName={commandName}
          lines={filtered}
          totalLogs={allLogs.length}
          showTimestamp={showTimestamp}
          follow={follow}
          isDark={isDark}
          onLineContextMenu={(index) => {
            onLineContextMenu(filtered, index);
          }}
        />
      </div>
    </div>
  );
});
