import { useSyncExternalStore } from 'react';
import { getActiveDrag, subscribeDrag } from './dnd';

/**
 * `true` while any sidebar drag (service / stack) is in flight.
 *
 * Drop-target containers (SectionBlock, UnassignedBlock) consume
 * this to paint a calm "you can drop here too" hint on the buckets
 * the cursor is NOT currently over — turns the sidebar into a
 * scannable affordance map without resorting to the loud accent
 * frame on the active hover (which the user explicitly asked us
 * to remove). The hovered bucket carries no extra paint; the
 * row-level insertion line still owns the precise landing slot.
 *
 * Implemented over `useSyncExternalStore` so React stays in sync
 * with the in-module `activeDrag` state without us re-implementing
 * subscribe / batched-update semantics by hand.
 */
export function useDragActive(): boolean {
  return useSyncExternalStore(
    subscribeDrag,
    () => getActiveDrag() != null,
    () => false,
  );
}
