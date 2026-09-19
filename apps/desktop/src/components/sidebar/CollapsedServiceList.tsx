import { cn } from '@/lib/cn';
import type { ServiceDef, ServiceStatus, Status } from '@/types';
import { SidebarAgentActivity } from './SidebarAgentActivity';

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
          <div key={service.id} className="relative">
            <button
              type="button"
              title={service.name}
              aria-pressed={selected}
              onClick={() => onSelect(service.id)}
              className={cn(
                'hover:bg-fg/4 relative flex h-8 w-8 items-center justify-center rounded-md transition',
                selected && 'bg-fg/6',
              )}
            >
              {isRunning && (
                <span className="bg-status-running absolute right-1 bottom-1 h-1 w-1 rounded-full" />
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
            <SidebarAgentActivity
              serviceIds={[service.id]}
              name={service.name}
              compact
              className="absolute -top-0.5 -right-1.5"
            />
          </div>
        );
      })}
    </div>
  );
}
