import { cn } from '@/lib/cn';
import type { ServiceDef, ServiceStatus, Status } from '@/types';

interface CollapsedServiceListProps {
  services: ServiceDef[];
  statuses: Record<string, ServiceStatus>;
  selectedServiceId: string | null;
  onSelect: (id: string) => void;
}

export function CollapsedServiceList({
  services,
  statuses,
  selectedServiceId,
  onSelect,
}: CollapsedServiceListProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      {services.map((service) => {
        const status: Status = statuses[service.id]?.status ?? 'stopped';
        const selected = selectedServiceId === service.id;
        const isRunning = status === 'running' || status === 'starting';
        return (
          <button
            key={service.id}
            type="button"
            title={service.name}
            onClick={() => onSelect(service.id)}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center transition',
              selected && 'glow-ring',
            )}
          >
            {isRunning && (
              <span className="bg-status-running/15 animate-pulse-dot absolute inset-0" />
            )}
            <span
              className={cn(
                'relative text-[11px] font-bold uppercase',
                selected ? 'text-accent' : isRunning ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {service.name.slice(0, 2)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
