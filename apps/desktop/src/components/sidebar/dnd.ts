import type { SectionId, ServiceDef } from '@/types';

export const COLLAPSED_W = 52;
export const MIN_W = 250;
export const MAX_W = 400;
export const DEFAULT_W = 320;

export const UNASSIGNED: SectionId = '__unassigned__';

export const DND_MIME = 'application/x-runhq-item';

export type DndKind = 'service' | 'stack';

export interface DragPayload {
  kind: DndKind;
  id: string;
}

let activeDrag: DragPayload | null = null;

/**
 * Pub-sub for drag-state changes. Drop targets that paint a "hey,
 * you can drop here too" hint while ANY drag is in flight subscribe
 * via {@link subscribeDrag} so they re-render when `activeDrag`
 * flips. We keep this outside Zustand on purpose — drag lifetime is
 * short (sub-second) and per-keystroke cheap, so a tiny in-module
 * Set of listeners is lighter than a full store slice.
 */
const dragListeners = new Set<() => void>();

function notifyDragListeners(): void {
  for (const fn of dragListeners) fn();
}

export function subscribeDrag(fn: () => void): () => void {
  dragListeners.add(fn);
  return () => {
    dragListeners.delete(fn);
  };
}

export function beginDrag(e: React.DragEvent, kind: DndKind, id: string): void {
  try {
    e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind, id }));
    e.dataTransfer.setData('text/plain', `${kind}:${id}`);
    e.dataTransfer.effectAllowed = 'move';
  } catch {
    // dataTransfer may be readonly in some environments
  }
  activeDrag = { kind, id };
  notifyDragListeners();
}

export function endDrag(): void {
  if (activeDrag == null) return;
  activeDrag = null;
  notifyDragListeners();
}

export function readDrag(e: React.DragEvent): DragPayload | null {
  if (activeDrag) return activeDrag;
  const raw = e.dataTransfer.getData(DND_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { kind?: string; id?: string };
    if ((p.kind === 'service' || p.kind === 'stack') && typeof p.id === 'string') {
      return { kind: p.kind, id: p.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function getActiveDrag(): DragPayload | null {
  return activeDrag;
}

export interface ServiceGroup {
  key: string;
  label: string;
  dot?: string;
  color?: string;
  services: ServiceDef[];
}

/**
 * Stable identifier used by the per-section item order map to address
 * a sidebar row regardless of whether it's a service or a stack. Lets
 * a single ordered list interleave the two without disambiguation.
 */
export function itemKey(kind: DndKind, id: string): string {
  return `${kind}:${id}`;
}
