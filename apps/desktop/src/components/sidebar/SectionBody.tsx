import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import type { SectionId, ServiceDef, StackDef, Status } from '@/types';
import { StackRow } from './StackRow';
import { ServiceRow } from './ServiceRow';
import { itemKey, UNASSIGNED } from './dnd';
import { ReorderRow } from './section-body/ReorderRow';
import { ReorderTail } from './section-body/ReorderTail';

/**
 * Discriminated row used by {@link SectionBody}. The caller (sidebar
 * rail) interleaves stacks and services into a single ordered list so
 * users can reorder them freely within a section instead of being
 * locked into "stacks then services" rendering.
 */
export type SidebarItem = { kind: 'service'; ref: ServiceDef } | { kind: 'stack'; ref: StackDef };

export interface BodyProps {
  /**
   * Ordered, interleaved rows for this bucket. The bucket itself is
   * identified by {@link bucketId}; items are arranged in the order
   * the user (or the alphabetical fallback) put them in. Empty
   * arrays render the "Drag services or stacks here" placeholder.
   */
  items: SidebarItem[];
  /**
   * Bucket key the drop targets should aim at. For real sections
   * this is the section id; for the Unassigned pseudo-section it's
   * the {@link UNASSIGNED} sentinel.
   *
   * `null` opts out of the drag-to-reorder gesture entirely (useful
   * for surfaces like grouped flat lists where row order is derived,
   * not user-controlled).
   */
  bucketId: SectionId | null;
  statuses: ReturnType<typeof useAppStore.getState>['statuses'];
  selectedServiceId: string | null;
  selectedStackId: string | null;
  serviceSection: Record<string, SectionId>;
  stackSection: Record<string, SectionId>;
  onSelectService: (id: string) => void;
  onSelectStack: (id: string) => void;
  onEditService: (svc: ServiceDef) => void;
  onDeleteService: (svc: ServiceDef) => void;
  onEditStack: (stack: StackDef) => void;
  onDeleteStack: (stack: StackDef) => void;
  emptyMessage?: string;
}

export function SectionBody({
  items,
  bucketId,
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
}: BodyProps) {
  if (items.length === 0) {
    return (
      <div className="border-border/60 mx-2 my-1 rounded-[6px] border border-dashed px-3 py-4 text-center">
        <p className="text-fg-dim text-[10.5px] leading-tight">Drag services or stacks here</p>
      </div>
    );
  }

  // The section header's drop handler maps "drop on the section but
  // not on a specific row gap" to "append to the end of this bucket".
  // For the Unassigned pseudo-section we pass `null` (the store's
  // section-id contract for unassigned), elsewhere the real id.
  const targetSectionId =
    bucketId == null || bucketId === UNASSIGNED ? null : (bucketId as SectionId);

  const reorderEnabled = bucketId != null;

  return (
    <ul className="mx-2 space-y-0.5">
      {items.map((item, idx) => {
        const key = itemKey(item.kind, item.ref.id);
        const rowContent =
          item.kind === 'stack' ? (
            <StackRowSlotInner
              stack={item.ref}
              statuses={statuses}
              active={selectedStackId === item.ref.id}
              currentSectionId={stackSection[item.ref.id] ?? null}
              onSelect={() => onSelectStack(item.ref.id)}
              onEdit={() => onEditStack(item.ref)}
              onDelete={() => onDeleteStack(item.ref)}
            />
          ) : (
            <ServiceRowSlotInner
              service={item.ref}
              statuses={statuses}
              selected={selectedServiceId === item.ref.id}
              currentSectionId={serviceSection[item.ref.id] ?? null}
              onSelect={() => onSelectService(item.ref.id)}
              onEdit={() => onEditService(item.ref)}
              onDelete={() => onDeleteService(item.ref)}
            />
          );

        if (!reorderEnabled) {
          return <li key={key}>{rowContent}</li>;
        }

        return (
          <ReorderRow
            key={key}
            index={idx}
            items={items}
            bucketId={bucketId}
            targetSectionId={targetSectionId}
            itemKeyFor={key}
          >
            {rowContent}
          </ReorderRow>
        );
      })}
      {reorderEnabled && (
        <ReorderTail
          items={items}
          bucketId={bucketId as SectionId}
          targetSectionId={targetSectionId}
        />
      )}
    </ul>
  );
}

function StackRowSlotInner({
  stack,
  statuses,
  active,
  currentSectionId,
  onSelect,
  onEdit,
  onDelete,
}: {
  stack: StackDef;
  statuses: ReturnType<typeof useAppStore.getState>['statuses'];
  active: boolean;
  currentSectionId: SectionId | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const running = stack.service_ids.filter((sid) => {
    const st: Status = statuses[sid]?.status ?? 'stopped';
    return st === 'running' || st === 'starting';
  }).length;
  return (
    <StackRow
      stackId={stack.id}
      currentSectionId={currentSectionId}
      name={stack.name}
      total={stack.service_ids.length}
      running={running}
      active={active}
      onSelect={onSelect}
      onStart={() => void ipc.startStack(stack.id)}
      onStop={() => void ipc.stopStack(stack.id)}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function ServiceRowSlotInner({
  service,
  statuses,
  selected,
  currentSectionId,
  onSelect,
  onEdit,
  onDelete,
}: {
  service: ServiceDef;
  statuses: ReturnType<typeof useAppStore.getState>['statuses'];
  selected: boolean;
  currentSectionId: SectionId | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ServiceRow
      service={service}
      status={statuses[service.id]?.status ?? 'stopped'}
      pid={statuses[service.id]?.pid ?? undefined}
      selected={selected}
      currentSectionId={currentSectionId}
      onSelect={onSelect}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

export function FlatItems(props: BodyProps) {
  if (props.items.length === 0) {
    return (
      <div className="text-fg-dim px-3 py-6 text-center text-[12px]">
        {props.emptyMessage ?? 'No services yet.'}
      </div>
    );
  }
  return <SectionBody {...props} />;
}
