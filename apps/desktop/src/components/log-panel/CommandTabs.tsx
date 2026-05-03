import { Play, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type { CommandStatus, ServiceDef } from '@/types';
import { badgeClass } from './model';

interface CommandTabsProps {
  activeCmd: string | null;
  cmdStatuses: CommandStatus[];
  onSelect: (commandName: string) => void;
  service: ServiceDef;
}

export function CommandTabs({ activeCmd, cmdStatuses, onSelect, service }: CommandTabsProps) {
  if (service.cmds.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-stretch gap-1">
      {service.cmds.map((entry) => {
        const commandStatus = cmdStatuses.find((command) => command.name === entry.name);
        const status = commandStatus?.status ?? 'stopped';
        const isActive = activeCmd === entry.name;
        const isRunning = status === 'running' || status === 'starting';
        return (
          <button
            key={entry.name}
            type="button"
            onClick={() => onSelect(entry.name)}
            className={cn(
              'rounded-app-sm group flex items-center gap-2 border px-2 py-1 text-left transition',
              isActive
                ? 'border-accent/40 bg-accent/10'
                : 'border-border/70 hover:bg-surface-overlay/60',
            )}
          >
            <span className={cn('svc-badge', badgeClass(entry.name), isActive && 'opacity-100')}>
              {entry.name}
            </span>
            <span className="text-fg-dim max-w-[160px] truncate text-[10px]">
              {isRunning && commandStatus?.pid != null ? `pid ${commandStatus.pid}` : entry.cmd}
            </span>
            <div
              role="button"
              tabIndex={0}
              title={isRunning ? `Stop ${entry.name}` : `Start ${entry.name}`}
              className={cn(
                'ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition',
                isRunning
                  ? 'text-status-error/70 hover:bg-status-error/10 hover:text-status-error'
                  : 'text-status-running/70 hover:bg-status-running/10 hover:text-status-running',
              )}
              onClick={(event) => {
                event.stopPropagation();
                if (isRunning) void ipc.stopServiceCmd(service.id, entry.name);
                else void ipc.startServiceCmd(service.id, entry.name);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                  if (isRunning) void ipc.stopServiceCmd(service.id, entry.name);
                  else void ipc.startServiceCmd(service.id, entry.name);
                }
              }}
            >
              {isRunning ? <Square className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
