import { SectionBlock } from './SectionBlock';
import { FlatItems, SectionBody, type SidebarItem } from './SectionBody';
import { UnassignedBlock } from './UnassignedBlock';
import { UNASSIGNED } from './dnd';
import type { Section, SectionId, ServiceDef, ServiceStatus, StackDef } from '@/types';

const itemServiceIds = (items: SidebarItem[]) =>
  items.flatMap((item) => (item.kind === 'stack' ? item.ref.service_ids : [item.ref.id]));

interface SidebarSectionLayoutProps {
  searching?: boolean;
  sections: Section[];
  itemsBySection: Map<SectionId, SidebarItem[]>;
  hasSections: boolean;
  collapsedSections: Record<string, boolean | undefined>;
  totalsBySection: Map<SectionId, { running: number; total: number }>;
  statuses: Record<string, ServiceStatus>;
  selectedServiceId: string | null;
  selectedStackId: string | null;
  serviceSection: Record<string, SectionId>;
  stackSection: Record<string, SectionId>;
  emptyMessage?: string;
  onToggleSection: (id: SectionId) => void;
  onSelectService: (id: string) => void;
  onSelectStack: (id: string) => void;
  onEditService: (service: ServiceDef) => void;
  onDeleteService: (service: ServiceDef) => void;
  onEditStack: (stack: StackDef) => void;
  onDeleteStack: (stack: StackDef) => void;
}

export function SidebarSectionLayout({
  searching = false,
  sections,
  itemsBySection,
  hasSections,
  collapsedSections,
  totalsBySection,
  statuses,
  selectedServiceId,
  selectedStackId,
  serviceSection,
  stackSection,
  emptyMessage,
  onToggleSection,
  onSelectService,
  onSelectStack,
  onEditService,
  onDeleteService,
  onEditStack,
  onDeleteStack,
}: SidebarSectionLayoutProps) {
  const commonProps = {
    statuses,
    selectedServiceId,
    selectedStackId,
    serviceSection,
    stackSection,
    onSelectService,
    onSelectStack,
    onEditService,
    onDeleteService,
    onEditStack,
    onDeleteStack,
  };

  if (!hasSections) {
    return (
      <FlatItems
        items={itemsBySection.get(UNASSIGNED) ?? []}
        bucketId={searching ? null : UNASSIGNED}
        emptyMessage={emptyMessage}
        {...commonProps}
      />
    );
  }

  const unassignedItems = itemsBySection.get(UNASSIGNED) ?? [];
  const stacksCount = unassignedItems.filter((item) => item.kind === 'stack').length;
  const servicesCount = unassignedItems.length - stacksCount;

  if (searching && ![...itemsBySection.values()].some((items) => items.length))
    return (
      <p className="text-fg-dim px-4 py-6 text-center text-[12px]">
        No matching projects or stacks.
      </p>
    );

  return (
    <>
      {sections
        .filter((section) => !searching || (itemsBySection.get(section.id)?.length ?? 0) > 0)
        .map((section) => {
          const totals = totalsBySection.get(section.id) ?? { running: 0, total: 0 };
          return (
            <SectionBlock
              key={section.id}
              section={section}
              collapsed={!searching && !!collapsedSections[section.id]}
              onToggle={() => onToggleSection(section.id)}
              running={totals.running}
              total={totals.total}
              serviceIds={itemServiceIds(itemsBySection.get(section.id) ?? [])}
            >
              <SectionBody
                items={itemsBySection.get(section.id) ?? []}
                bucketId={searching ? null : section.id}
                {...commonProps}
              />
            </SectionBlock>
          );
        })}

      {(!searching || unassignedItems.length > 0) && (
        <UnassignedBlock
          collapsed={!searching && !!collapsedSections[UNASSIGNED]}
          onToggle={() => onToggleSection(UNASSIGNED)}
          stacksCount={stacksCount}
          servicesCount={servicesCount}
          serviceIds={itemServiceIds(unassignedItems)}
        >
          <SectionBody
            items={unassignedItems}
            bucketId={searching ? null : UNASSIGNED}
            {...commonProps}
          />
        </UnassignedBlock>
      )}
    </>
  );
}
