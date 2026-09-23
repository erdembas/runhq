import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { WorkspaceGroupHeader } from '@runhq/cockpit-ui';
import { SectionOverflowMenu } from '../SectionMenus';
import { useAppStore } from '@/store/useAppStore';
import { sectionColor } from '@/lib/sectionColors';
import { readDrag, endDrag, getActiveDrag } from './dnd';
import { useDragActive } from './useDragActive';
import type { Section } from '@/types';
import { SidebarAgentActivity } from './SidebarAgentActivity';

export function SectionBlock({
  section,
  collapsed,
  onToggle,
  running,
  total,
  serviceIds,
  children,
}: {
  section: Section;
  collapsed: boolean;
  onToggle: () => void;
  running: number;
  total: number;
  serviceIds: string[];
  children: React.ReactNode;
}) {
  i18n.useLocale();
  const meta = sectionColor(section.color);
  const moveSidebarItem = useAppStore((s) => s.moveSidebarItem);
  const dragActive = useDragActive();
  const [isOver, setIsOver] = useState(false);

  // Drag handlers stay so the section still accepts a drop that
  // isn't aimed at a specific row gap (= "park at the end of this
  // bucket"). We track `isOver` only to *suppress* the global
  // "you can drop here" hint on the section the cursor is already
  // inside — the cursor itself plus the row-level insertion line
  // are signal enough on the active hover; painting the same
  // outline there too would compete for the eye.
  const onDragOver = (e: React.DragEvent) => {
    if (getActiveDrag() == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isOver) setIsOver(true);
  };
  const onDragEnter = (e: React.DragEvent) => {
    if (getActiveDrag() == null) return;
    e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    // Ignore enter/leave events into our own children — only an
    // actual exit out of the section element should clear `isOver`.
    const rel = e.relatedTarget as globalThis.Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setIsOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const payload = readDrag(e);
    if (!payload) return;
    // Route through `moveSidebarItem` (with `beforeKey = null` =
    // append) instead of the legacy `assignSection` actions. The
    // legacy path is a no-op for same-bucket drops, which is what
    // produced the "I can't drag a row to the very bottom of its
    // own section" bug — falling onto the section frame below the
    // last row triggered this handler but the assign action saw
    // "you're already in this section, nothing to do" and bailed.
    moveSidebarItem(payload.kind, payload.id, section.id, null);
    endDrag();
  };

  // Subtle "drop available here" hint painted on the OTHER buckets
  // (i.e. every section the cursor is NOT currently over) while a
  // drag is in flight. A 1px dashed accent outline tinted at low
  // alpha — visible enough to scan the sidebar for available
  // targets, calm enough to disappear from attention as soon as the
  // cursor lands somewhere. Uniform color across sections (we used
  // to tint with `meta.solid`, but per design feedback all hints
  // now share the same accent so the eye reads them as one
  // affordance system instead of competing color frames).
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
        name={section.name}
        color={meta.solid}
        collapsed={collapsed}
        onToggle={onToggle}
        count={total}
        running={running}
        activity={<SidebarAgentActivity serviceIds={serviceIds} name={section.name} />}
        actions={<SectionOverflowMenu section={section} />}
      />
      {!collapsed && <div className="border-border/60 ml-3 border-l pb-1 pl-1">{children}</div>}
    </section>
  );
}
