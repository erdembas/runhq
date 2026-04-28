import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import { readDrag, endDrag, getActiveDrag } from './dnd';
import { useDragActive } from './useDragActive';

export function UnassignedBlock({
  collapsed,
  onToggle,
  stacksCount,
  servicesCount,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  stacksCount: number;
  servicesCount: number;
  children: React.ReactNode;
}) {
  const total = stacksCount + servicesCount;
  const moveSidebarItem = useAppStore((s) => s.moveSidebarItem);
  const dragActive = useDragActive();
  const [isOver, setIsOver] = useState(false);

  // Same drop contract as SectionBlock: dropping anywhere on this
  // bucket (outside row insertion zones) parks the item at the end
  // of Unassigned. We track `isOver` only to suppress the global
  // "you can drop here too" hint while the cursor is inside this
  // bucket — the row insertion line owns the precise position.
  const onDragEnter = (e: React.DragEvent) => {
    if (getActiveDrag() == null) return;
    e.preventDefault();
  };
  const onDragOver = (e: React.DragEvent) => {
    if (getActiveDrag() == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isOver) setIsOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    const rel = e.relatedTarget as globalThis.Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setIsOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const payload = readDrag(e);
    if (!payload) return;
    // Route through `moveSidebarItem` (append) — see SectionBlock
    // for the "why" (legacy assign actions are no-ops for
    // same-bucket reorders).
    moveSidebarItem(payload.kind, payload.id, null, null);
    endDrag();
  };

  // Same dashed-accent hint as SectionBlock so all candidate buckets
  // read as one uniform affordance map while a drag is in flight.
  const showDropHint = dragActive && !isOver;

  return (
    <section
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="animate-slide-in relative mx-1 rounded-[8px]"
      style={{
        outline: '1px dashed',
        outlineOffset: '-2px',
        outlineColor: showDropHint ? 'rgb(var(--accent) / 0.35)' : 'transparent',
        transition: 'outline-color 150ms',
      }}
    >
      <header
        onClick={onToggle}
        className="hover:bg-surface-overlay/40 sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-transparent pt-2.5 pr-4 pb-1 pl-2 backdrop-blur-[2px]"
      >
        <ChevronDown
          className={cn('text-fg-dim h-3 w-3 transition-transform', collapsed && '-rotate-90')}
        />
        <span className="bg-fg-dim/40 h-2 w-2 shrink-0 rounded-full" aria-hidden />
        <span className="text-fg-muted min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide">
          Unassigned
        </span>
        {total > 0 && (
          <span className="bg-surface-muted text-fg-dim rounded-app-sm inline-flex h-[18px] min-w-[22px] shrink-0 items-center justify-center px-1 text-[10px] leading-none tabular-nums">
            {total}
          </span>
        )}
      </header>
      {!collapsed && <div className="pb-1">{children}</div>}
    </section>
  );
}
