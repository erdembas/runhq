import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import type { SectionId } from '@/types';
import { endDrag, getActiveDrag, itemKey, readDrag } from '../dnd';
import type { SidebarItem } from '../SectionBody';

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
export function ReorderTail({
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
