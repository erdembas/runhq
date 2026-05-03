import { SectionBlock } from './SectionBlock';
import { FlatItems, SectionBody, type SidebarItem } from './SectionBody';
import { UnassignedBlock } from './UnassignedBlock';
import { UNASSIGNED } from './dnd';
import type { Section, SectionId, ServiceDef, ServiceStatus, StackDef } from '@/types';

interface SidebarSectionLayoutProps {
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
        bucketId={UNASSIGNED}
        emptyMessage={emptyMessage}
        {...commonProps}
      />
    );
  }

  const unassignedItems = itemsBySection.get(UNASSIGNED) ?? [];
  const stacksCount = unassignedItems.filter((item) => item.kind === 'stack').length;
  const servicesCount = unassignedItems.length - stacksCount;

  return (
    <>
      {sections.map((section) => {
        const totals = totalsBySection.get(section.id) ?? { running: 0, total: 0 };
        return (
          <SectionBlock
            key={section.id}
            section={section}
            collapsed={!!collapsedSections[section.id]}
            onToggle={() => onToggleSection(section.id)}
            running={totals.running}
            total={totals.total}
          >
            <SectionBody
              items={itemsBySection.get(section.id) ?? []}
              bucketId={section.id}
              {...commonProps}
            />
          </SectionBlock>
        );
      })}

      <UnassignedBlock
        collapsed={!!collapsedSections[UNASSIGNED]}
        onToggle={() => onToggleSection(UNASSIGNED)}
        stacksCount={stacksCount}
        servicesCount={servicesCount}
      >
        <SectionBody items={unassignedItems} bucketId={UNASSIGNED} {...commonProps} />
      </UnassignedBlock>
    </>
  );
}
