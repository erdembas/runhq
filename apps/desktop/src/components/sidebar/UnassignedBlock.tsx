import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { WorkspaceGroupHeader } from '@runhq/cockpit-ui';
import { useAppStore } from '@/store/useAppStore';
import { readDrag, endDrag, getActiveDrag } from './dnd';
import { useDragActive } from './useDragActive';
import { SidebarAgentActivity } from './SidebarAgentActivity';

export function UnassignedBlock({
  collapsed,
  onToggle,
  stacksCount,
  servicesCount,
  serviceIds,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  stacksCount: number;
  servicesCount: number;
  serviceIds: string[];
  children: React.ReactNode;
}) {
  i18n.useLocale();
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
      className="animate-slide-in relative mx-2 my-2 rounded-xl"
      style={{
        outline: '1px dashed',
        outlineOffset: '-2px',
        outlineColor: showDropHint ? 'rgb(var(--accent) / 0.35)' : 'transparent',
        transition: 'outline-color 150ms',
      }}
    >
      <WorkspaceGroupHeader
        name="Unassigned"
        collapsed={collapsed}
        onToggle={onToggle}
        count={total}
        activity={<SidebarAgentActivity serviceIds={serviceIds} name="Unassigned" />}
      />
      {!collapsed && <div className="border-border/60 ml-3 border-l pb-1 pl-1">{children}</div>}
    </section>
  );
}
