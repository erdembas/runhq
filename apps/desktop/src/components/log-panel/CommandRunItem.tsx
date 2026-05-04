import { Play, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import type { CommandEntry, CommandStatus } from '@/types';
import { badgeClass } from './model';

interface CommandRunItemProps {
  active: boolean;
  command: CommandEntry;
  serviceId: string;
  status: CommandStatus | undefined;
  onSelect: (commandName: string) => void;
}

export function CommandRunItem({
  active,
  command,
  serviceId,
  status,
  onSelect,
}: CommandRunItemProps) {
  const runtimeStatus = status?.status ?? 'stopped';
  const isRunning = runtimeStatus === 'running' || runtimeStatus === 'starting';

  return (
    <div
      className={cn(
        'rounded-app-sm bg-surface-muted/50 flex h-7 shrink-0 items-center overflow-hidden border transition',
        active ? 'border-accent/40 bg-accent/10' : 'border-border/70',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(command.name)}
        title={command.cmd}
        className="hover:bg-surface-overlay/70 flex h-full min-w-0 items-center gap-1.5 px-2 text-left transition"
      >
        <span className={cn('svc-badge shrink-0', badgeClass(command.name))}>{command.name}</span>
        <span className="text-fg-dim max-w-[150px] truncate font-mono text-[10px]">
          {isRunning && status?.pid != null ? `pid ${status.pid}` : command.cmd}
        </span>
      </button>
      <button
        type="button"
        title={isRunning ? `Stop ${command.name}` : `Start ${command.name}`}
        aria-label={isRunning ? `Stop ${command.name}` : `Start ${command.name}`}
        className={cn(
          'border-border/60 flex h-full w-7 shrink-0 items-center justify-center border-l transition',
          isRunning
            ? 'text-status-error/80 hover:bg-status-error/10 hover:text-status-error'
            : 'text-status-running/80 hover:bg-status-running/10 hover:text-status-running',
        )}
        onClick={() => {
          if (isRunning) void ipc.stopServiceCmd(serviceId, command.name);
          else void ipc.startServiceCmd(serviceId, command.name);
        }}
      >
        {isRunning ? <Square className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
      </button>
    </div>
  );
}
