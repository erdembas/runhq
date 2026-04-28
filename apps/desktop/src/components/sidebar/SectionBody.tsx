import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import type { SectionId, ServiceDef, StackDef, Status } from '@/types';
import { StackRow } from './StackRow';
import { ServiceRow } from './ServiceRow';
import { endDrag, getActiveDrag, itemKey, readDrag, UNASSIGNED } from './dnd';

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

type DropEdge = 'top' | 'bottom';

/**
 * Wraps a single row and turns it into a reorder drop target. Instead
 * of injecting separate drop "strips" between rows (which makes the
 * indicator pop in and out as the cursor crosses zone boundaries — the
 * "feels like a forced drag" bug), the row itself owns the drop logic:
 *
 *   - Hovering the **top half** previews "insert before this row".
 *   - Hovering the **bottom half** previews "insert after this row".
 *
 * The indicator is an absolutely-positioned 2px line that fades in/out
 * via CSS opacity transition, so the highlight glides between the row
 * boundaries instead of snapping. No layout shift means the dragged
 * row doesn't visually jitter while you hunt for the right slot.
 */
function ReorderRow({
  index,
  items,
  bucketId,
  targetSectionId,
  itemKeyFor,
  children,
}: {
  index: number;
  items: SidebarItem[];
  bucketId: SectionId;
  targetSectionId: SectionId | null;
  /** Pre-computed key for `items[index]` so we don't recompute it on every dragover tick. */
  itemKeyFor: string;
  children: React.ReactNode;
}) {
  const moveSidebarItem = useAppStore((s) => s.moveSidebarItem);
  const [edge, setEdge] = useState<DropEdge | null>(null);

  const prevItem = items[index - 1];
  const nextItem = items[index + 1];
  const prevKey = prevItem ? itemKey(prevItem.kind, prevItem.ref.id) : null;
  const nextKey = nextItem ? itemKey(nextItem.kind, nextItem.ref.id) : null;

  /** Resolve cursor Y → which edge of the row is the user aiming at. */
  const resolveEdge = (e: React.DragEvent): DropEdge => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
  };

  /**
   * No-op cases — dragging onto a slot that wouldn't move the item.
   * We early-return without `preventDefault` so the parent
   * SectionBlock keeps the bucket-level "drop anywhere → assign"
   * highlight, but our local insertion line stays hidden.
   */
  const isNoop = (draggedKey: string, target: DropEdge): boolean => {
    if (draggedKey === itemKeyFor) return true;
    if (target === 'top' && draggedKey === prevKey) return true;
    if (target === 'bottom' && draggedKey === nextKey) return true;
    return false;
  };

  const handleOver = (e: React.DragEvent) => {
    const drag = getActiveDrag();
    if (drag == null) return;
    const draggedKey = itemKey(drag.kind, drag.id);
    const target = resolveEdge(e);
    if (isNoop(draggedKey, target)) {
      if (edge != null) setEdge(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (edge !== target) setEdge(target);
  };

  const handleLeave = (e: React.DragEvent) => {
    // Ignore leave events into our own children.
    const rel = e.relatedTarget as globalThis.Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setEdge(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    const payload = readDrag(e);
    if (!payload) return;
    const draggedKey = itemKey(payload.kind, payload.id);
    const target = resolveEdge(e);
    if (isNoop(draggedKey, target)) return;
    e.preventDefault();
    e.stopPropagation();
    setEdge(null);
    endDrag();
    const beforeKey = target === 'top' ? itemKeyFor : nextKey;
    moveSidebarItem(payload.kind, payload.id, targetSectionId, beforeKey);
  };

  return (
    <li
      onDragEnter={handleOver}
      onDragOver={handleOver}
      onDragLeave={handleLeave}
      onDrop={handleDrop}
      className="relative"
      data-bucket={bucketId}
    >
      {/*
        Top / bottom indicator lines. Always mounted so opacity
        transitions can animate them in/out smoothly; absolutely
        positioned over the row's edge so they don't push siblings
        around (zero layout shift while the cursor scans rows).
      */}
      <span
        aria-hidden
        className={cn(
          'bg-accent pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded-full transition-opacity duration-100',
          edge === 'top' ? 'opacity-100' : 'opacity-0',
        )}
      />
      {children}
      <span
        aria-hidden
        className={cn(
          'bg-accent pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-opacity duration-100',
          edge === 'bottom' ? 'opacity-100' : 'opacity-0',
        )}
      />
    </li>
  );
}

/**
 * Sentinel drop zone rendered AFTER the last real row.
 *
 * Without this, the "drop below the last item to send it to the
 * bottom of the bucket" gesture has nowhere to land — the row's
 * own bottom-half target only covers the row's own bounding box,
 * and the section frame's drop handler used to fall back to
 * `assignSection` which is a no-op for same-bucket reorders.
 *
 * The tail catches drags whose target is "after row N" specifically
 * for the case where N is the last index. We deliberately render
 * a generous-but-still-thin hit area (12px) so the user doesn't
 * have to pixel-hunt the gap; the accent insertion line at its
 * top edge confirms the landing slot just like every other row.
 */
function ReorderTail({
  items,
  bucketId,
  targetSectionId,
}: {
  items: SidebarItem[];
  bucketId: SectionId;
  targetSectionId: SectionId | null;
}) {
  const moveSidebarItem = useAppStore((s) => s.moveSidebarItem);
  const [active, setActive] = useState(false);
  const lastItem = items[items.length - 1];
  const lastKey = lastItem ? itemKey(lastItem.kind, lastItem.ref.id) : null;

  // Already-at-the-end no-op: dragging the last row "below itself"
  // shouldn't paint or accept the indicator.
  const isNoop = (draggedKey: string) => draggedKey === lastKey;

  const handleOver = (e: React.DragEvent) => {
    const drag = getActiveDrag();
    if (drag == null) return;
    const draggedKey = itemKey(drag.kind, drag.id);
    if (isNoop(draggedKey)) {
      if (active) setActive(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!active) setActive(true);
  };

  const handleLeave = (e: React.DragEvent) => {
    const rel = e.relatedTarget as globalThis.Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    const payload = readDrag(e);
    if (!payload) return;
    const draggedKey = itemKey(payload.kind, payload.id);
    if (isNoop(draggedKey)) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(false);
    endDrag();
    moveSidebarItem(payload.kind, payload.id, targetSectionId, null);
  };

  return (
    <li
      onDragEnter={handleOver}
      onDragOver={handleOver}
      onDragLeave={handleLeave}
      onDrop={handleDrop}
      className="relative h-3"
      data-bucket={bucketId}
      data-tail="true"
    >
      <span
        aria-hidden
        className={cn(
          'bg-accent pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full transition-opacity duration-100',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
    </li>
  );
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
