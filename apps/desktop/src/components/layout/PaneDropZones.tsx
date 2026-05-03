/**
 * Edge-drop overlay for a single pane. Renders 4 droppable regions
 * (top/right/bottom/left strips) plus a center region.
 *
 * Geometry mirrors VS Code's editor-drop overlay: each edge strip
 * occupies ~25 % of the pane on its respective axis, the center
 * fills the remaining cross. We deliberately don't slice the
 * corners into separate targets — a corner drop just falls into
 * whichever edge gets it first via dnd-kit's collision detection,
 * and any of the 4 outcomes is "fine" (you'd asked for a split,
 * we picked the closest axis).
 *
 * IMPORTANT — pointer-events gating:
 *   When no drag is in progress (`visible === false`), every
 *   sub-region is `pointer-events:none`. Earlier versions left the
 *   drop targets clickable at all times because dnd-kit's docs
 *   imply collision detection needs a pointer-target; in practice
 *   it just calls `getBoundingClientRect()` on the mounted ref so
 *   pointer events are NOT required for collision math. Leaving
 *   them on swallowed every click that landed inside the pane —
 *   which the user noticed the moment they tried to focus a second
 *   terminal: the click went into our overlay instead of xterm,
 *   xterm never got focus, and keystrokes vanished. Gating the
 *   pointer-events flip on `visible` keeps the targets discoverable
 *   to dnd-kit (refs still mounted) without stealing input from
 *   the active body.
 */

import { useDroppable } from '@dnd-kit/core';

import { cn } from '@/lib/cn';

import type { SplitEdge } from './layoutModel';

interface Props {
  groupId: string;
  /**
   * `true` while a tab drag is in progress anywhere in the
   * service. Drives both the visible accent overlay AND the
   * pointer-events flip — see module JSDoc for the rationale on
   * why the flip is necessary.
   */
  visible: boolean;
}

export function PaneDropZones({ groupId, visible }: Props) {
  const center = useDroppable({
    id: `pane:${groupId}:center`,
    data: { kind: 'pane-center', groupId },
  });
  const top = useDroppable({
    id: `pane:${groupId}:top`,
    data: { kind: 'pane-edge', groupId, edge: 'top' as SplitEdge },
  });
  const right = useDroppable({
    id: `pane:${groupId}:right`,
    data: { kind: 'pane-edge', groupId, edge: 'right' as SplitEdge },
  });
  const bottom = useDroppable({
    id: `pane:${groupId}:bottom`,
    data: { kind: 'pane-edge', groupId, edge: 'bottom' as SplitEdge },
  });
  const left = useDroppable({
    id: `pane:${groupId}:left`,
    data: { kind: 'pane-edge', groupId, edge: 'left' as SplitEdge },
  });

  // Single class toggle keeps the JSX flat and ensures every
  // sub-region flips together — there's no "half-on" state where
  // some edges steal clicks while others don't.
  const interactive = visible ? 'pointer-events-auto' : 'pointer-events-none';

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Center — large fallback area. No visible overlay; we don't
          want to obstruct what the user is looking at while they
          drag, only the edges need to advertise themselves. */}
      <div ref={center.setNodeRef} className={cn('absolute inset-[25%]', interactive)}>
        {visible && center.isOver && (
          <div className="bg-accent/15 ring-accent/40 absolute inset-0 rounded ring-2" />
        )}
      </div>

      {/* Top strip */}
      <div ref={top.setNodeRef} className={cn('absolute top-0 right-0 left-0 h-1/4', interactive)}>
        {visible && (
          <div
            className={cn(
              'absolute inset-1 rounded transition-colors',
              top.isOver ? 'bg-accent/25 ring-accent/50 ring-2' : 'bg-accent/5',
            )}
          />
        )}
      </div>

      {/* Right strip */}
      <div
        ref={right.setNodeRef}
        className={cn('absolute top-0 right-0 bottom-0 w-1/4', interactive)}
      >
        {visible && (
          <div
            className={cn(
              'absolute inset-1 rounded transition-colors',
              right.isOver ? 'bg-accent/25 ring-accent/50 ring-2' : 'bg-accent/5',
            )}
          />
        )}
      </div>

      {/* Bottom strip */}
      <div
        ref={bottom.setNodeRef}
        className={cn('absolute right-0 bottom-0 left-0 h-1/4', interactive)}
      >
        {visible && (
          <div
            className={cn(
              'absolute inset-1 rounded transition-colors',
              bottom.isOver ? 'bg-accent/25 ring-accent/50 ring-2' : 'bg-accent/5',
            )}
          />
        )}
      </div>

      {/* Left strip */}
      <div
        ref={left.setNodeRef}
        className={cn('absolute top-0 bottom-0 left-0 w-1/4', interactive)}
      >
        {visible && (
          <div
            className={cn(
              'absolute inset-1 rounded transition-colors',
              left.isOver ? 'bg-accent/25 ring-accent/50 ring-2' : 'bg-accent/5',
            )}
          />
        )}
      </div>
    </div>
  );
}
