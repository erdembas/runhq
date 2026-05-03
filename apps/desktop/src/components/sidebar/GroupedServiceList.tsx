import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ServiceRow } from './ServiceRow';
import type { ServiceGroup } from './dnd';
import type { SectionId, ServiceDef, ServiceStatus } from '@/types';

interface GroupedServiceListProps {
  groups: ServiceGroup[];
  collapsedGroups: Set<string>;
  statuses: Record<string, ServiceStatus>;
  selectedServiceId: string | null;
  serviceSection: Record<string, SectionId>;
  onToggleGroup: (key: string) => void;
  onSelect: (id: string) => void;
  onEdit: (service: ServiceDef) => void;
  onDelete: (service: ServiceDef) => void;
}

export function GroupedServiceList({
  groups,
  collapsedGroups,
  statuses,
  selectedServiceId,
  serviceSection,
  onToggleGroup,
  onSelect,
  onEdit,
  onDelete,
}: GroupedServiceListProps) {
  return (
    <>
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <section key={group.key} className="animate-slide-in">
            <header
              onClick={() => onToggleGroup(group.key)}
              className="hover:bg-surface-overlay/40 sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-transparent py-1 pr-4 pl-3 backdrop-blur-[2px]"
            >
              <ChevronDown
                className={cn(
                  'text-fg-dim h-3 w-3 transition-transform',
                  collapsed && '-rotate-90',
                )}
              />
              {group.dot && (
                <span className={cn('h-1.5 w-1.5 rounded-full', group.dot)} aria-hidden />
              )}
              <span
                className={cn(
                  'text-[10.5px] font-semibold tracking-[0.14em] uppercase',
                  group.color ?? 'text-fg-dim',
                )}
              >
                {group.label}
              </span>
              <span className="text-fg-dim bg-surface-muted rounded-app-sm ml-auto px-1.5 text-[10px] tabular-nums">
                {group.services.length}
              </span>
            </header>
            {!collapsed && (
              <ul className="mx-2 my-1 space-y-0.5">
                {group.services.map((service) => (
                  <li key={service.id}>
                    <ServiceRow
                      service={service}
                      status={statuses[service.id]?.status ?? 'stopped'}
                      pid={statuses[service.id]?.pid ?? undefined}
                      selected={selectedServiceId === service.id}
                      currentSectionId={serviceSection[service.id] ?? null}
                      onSelect={() => onSelect(service.id)}
                      onEdit={() => onEdit(service)}
                      onDelete={() => onDelete(service)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
