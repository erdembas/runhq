import { useState, type ReactNode } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import type { SectionId } from '@/types';
import { endDrag, getActiveDrag, itemKey, readDrag } from '../dnd';
import type { SidebarItem } from '../SectionBody';

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
export function ReorderRow({
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
  children: ReactNode;
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
