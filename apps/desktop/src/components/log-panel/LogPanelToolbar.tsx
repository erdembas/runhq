import { Network, Play, RotateCcw, Search, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GitStatusChip } from '@/components/GitStatusChip';
import { PopoverChip } from './PopoverChip';
import { PortsPopoverBody } from './PortsPopoverBody';
import type { ListeningPort, ServiceDef } from '@/types';

interface LogPanelToolbarProps {
  filter: string;
  isServiceRunning: boolean;
  onOpenPopoverChange: (open: boolean) => void;
  onRestart: () => void;
  onSetFilter: (filter: string) => void;
  onStart: () => void;
  onStop: () => void;
  openPortsPopover: boolean;
  ports: ListeningPort[];
  service: ServiceDef;
  servicePid: number | null;
}

export function LogPanelToolbar({
  filter,
  isServiceRunning,
  onOpenPopoverChange,
  onRestart,
  onSetFilter,
  onStart,
  onStop,
  openPortsPopover,
  ports,
  service,
  servicePid,
}: LogPanelToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {isServiceRunning ? (
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Square className="h-3 w-3" />}
            onClick={onStop}
          >
            Stop{service.cmds.length > 1 ? ' all' : ''}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Play className="h-3 w-3 fill-current" />}
            onClick={onStart}
          >
            {service.cmds.length > 1 ? 'Play all' : 'Play'}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RotateCcw className="h-3 w-3" />}
          onClick={onRestart}
        >
          Restart
        </Button>
        {isServiceRunning && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Square className="h-3 w-3" />}
            onClick={onStop}
          >
            Stop
          </Button>
        )}
      </div>

      <div className="relative w-full max-w-[280px]">
        <Search className="text-fg-dim pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2" />
        <input
          value={filter}
          onChange={(event) => onSetFilter(event.target.value)}
          placeholder="Filter logs…"
          className="border-border bg-surface-muted/70 text-fg placeholder:text-fg-dim focus:border-accent/60 focus:bg-surface rounded-app-sm h-7 w-full border px-2 pl-7 text-[12px] transition focus:outline-none"
        />
        <kbd className="text-fg-dim border-border bg-surface absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded border px-1 font-mono text-[9.5px] md:inline">
          /
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <GitStatusChip key={service.id} serviceId={service.id} />
        <PopoverChip
          icon={<Network className="h-3 w-3" />}
          label="Ports"
          count={ports.length}
          open={openPortsPopover}
          onToggle={() => onOpenPopoverChange(!openPortsPopover)}
          onClose={() => onOpenPopoverChange(false)}
        >
          <PortsPopoverBody ports={ports} pid={servicePid} />
        </PopoverChip>
      </div>
    </div>
  );
}
