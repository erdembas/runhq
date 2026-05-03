import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import type { ServiceDef, StackDef } from '@/types';

import {
  WorkspaceHeader,
  CreateActionsFooter,
  CollapsedServiceList,
  GroupedServiceList,
  SidebarHomeButton,
  SidebarSectionLayout,
  COLLAPSED_W,
  getActiveDrag,
  useSidebarRailModel,
  useSidebarRailResize,
} from './sidebar';

export function SidebarRail() {
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const selectedServiceId = useAppStore((s) => s.selectedServiceId);
  const selectedStackId = useAppStore((s) => s.selectedStackId);
  const categoryFilter = useAppStore((s) => s.categoryFilter);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const sidebarStatusFilter = useAppStore((s) => s.sidebarStatusFilter);
  const groupBy = useAppStore((s) => s.sidebarGroupBy);
  const search = useAppStore((s) => s.search);
  const setSelected = useAppStore((s) => s.setSelected);
  const removeServiceLocal = useAppStore((s) => s.removeService);
  const openEditor = useAppStore((s) => s.openEditor);
  const stacks = useAppStore((s) => s.stacks);
  const removeStackLocal = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const sections = useAppStore((s) => s.sections);
  const serviceSection = useAppStore((s) => s.serviceSection);
  const stackSection = useAppStore((s) => s.stackSection);
  const collapsedSections = useAppStore((s) => s.collapsedSections);
  const sectionItemOrder = useAppStore((s) => s.sectionItemOrder);
  const toggleSectionCollapsed = useAppStore((s) => s.toggleSectionCollapsed);

  // `pinned` lives in the global store now (see `sidebarPinned` /
  // `setSidebarPinned`) so the `toggle_left_sidebar` keyboard
  // shortcut can flip it from anywhere in the app and the choice
  // survives reloads. The local boolean used to fork on every
  // render — keeping the rail-controlled UI in sync with the store
  // is a one-liner because both are plain booleans.
  const pinned = useAppStore((s) => s.sidebarPinned);
  const setPinned = useAppStore((s) => s.setSidebarPinned);
  const [hovered, setHovered] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { width, onResizeStart, onResizeMove, onResizeEnd } = useSidebarRailResize();

  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const expanded = pinned || hovered;

  useEffect(() => {
    const onDoc = (e: globalThis.DragEvent) => {
      if (getActiveDrag() == null) return;
      e.preventDefault();
    };
    document.addEventListener('dragover', onDoc);
    document.addEventListener('dragenter', onDoc);
    return () => {
      document.removeEventListener('dragover', onDoc);
      document.removeEventListener('dragenter', onDoc);
    };
  }, []);

  const {
    filteredServices,
    itemsBySection,
    totalsBySection,
    flatGroups,
    runningCount,
    hiddenCount,
  } = useSidebarRailModel({
    services,
    statuses,
    stacks,
    categoryFilter,
    runtimeFilter,
    sidebarStatusFilter,
    groupBy,
    search,
    sections,
    serviceSection,
    stackSection,
    sectionItemOrder,
  });
  const currentWidth = expanded ? width : COLLAPSED_W;
  const onHomeSelected = selectedServiceId === null && selectedStackId === null;
  const useSectionLayout = groupBy === 'none';
  const hasSections = sections.length > 0;

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const requestDeleteService = useCallback(
    (svc: ServiceDef) => {
      setPendingConfirm({
        message: `Delete "${svc.name}"?`,
        onConfirm: async () => {
          setPendingConfirm(null);
          await ipc.stopService(svc.id).catch(() => undefined);
          await ipc.removeService(svc.id);
          removeServiceLocal(svc.id);
        },
      });
    },
    [removeServiceLocal],
  );

  const requestDeleteStack = useCallback(
    (stack: StackDef) => {
      setPendingConfirm({
        message: `Delete stack "${stack.name}"?`,
        onConfirm: async () => {
          setPendingConfirm(null);
          await ipc.removeStack(stack.id);
          removeStackLocal(stack.id);
        },
      });
    },
    [removeStackLocal],
  );

  return (
    <div
      className="chrome-gradient border-border/70 bg-surface-raised relative flex h-full shrink-0 flex-col border-r transition-all duration-200"
      style={{ width: currentWidth }}
      onMouseEnter={() => {
        if (!pinned) setHovered(true);
      }}
      onMouseLeave={() => {
        if (!pinned) setHovered(false);
      }}
    >
      <SidebarHomeButton
        expanded={expanded}
        pinned={pinned}
        selected={onHomeSelected}
        onSelect={() => {
          setSelected(null);
          setSelectedStack(null);
        }}
        onTogglePinned={() => setPinned(!pinned)}
      />

      <div className="overlay-scroll min-h-0 flex-1 overflow-x-hidden">
        {expanded && (
          <WorkspaceHeader
            servicesCount={services.length}
            runningCount={runningCount}
            stacksCount={stacks.length}
          />
        )}

        {expanded && hiddenCount > 0 && (
          <div className="border-border/60 mx-3 mb-1 flex items-center gap-2 rounded-[6px] border border-dashed px-2 py-1">
            <span className="text-fg-dim text-[10.5px]">
              Showing {filteredServices.length} · {hiddenCount} hidden
            </span>
          </div>
        )}

        {!expanded && (
          <CollapsedServiceList
            services={services}
            statuses={statuses}
            selectedServiceId={selectedServiceId}
            onSelect={setSelected}
          />
        )}

        {expanded && !useSectionLayout && flatGroups.length === 0 && (
          <div className="text-fg-dim px-3 py-6 text-center text-[12px]">
            {services.length === 0 ? 'No services yet.' : 'No matches for this filter.'}
          </div>
        )}

        {expanded && !useSectionLayout && (
          <GroupedServiceList
            groups={flatGroups}
            collapsedGroups={collapsedGroups}
            statuses={statuses}
            selectedServiceId={selectedServiceId}
            serviceSection={serviceSection}
            onToggleGroup={toggleGroupCollapsed}
            onSelect={setSelected}
            onEdit={openEditor}
            onDelete={requestDeleteService}
          />
        )}

        {expanded && useSectionLayout && (
          <SidebarSectionLayout
            sections={sections}
            itemsBySection={itemsBySection}
            hasSections={hasSections}
            collapsedSections={collapsedSections}
            totalsBySection={totalsBySection}
            statuses={statuses}
            selectedServiceId={selectedServiceId}
            selectedStackId={selectedStackId}
            serviceSection={serviceSection}
            stackSection={stackSection}
            onToggleSection={toggleSectionCollapsed}
            onSelectService={setSelected}
            onSelectStack={setSelectedStack}
            onEditService={openEditor}
            onDeleteService={requestDeleteService}
            onEditStack={openStackEditor}
            onDeleteStack={requestDeleteStack}
            emptyMessage={
              services.length === 0 && stacks.length === 0
                ? 'No services yet.'
                : hiddenCount > 0
                  ? 'No matches for this filter.'
                  : undefined
            }
          />
        )}
      </div>

      {expanded && (
        <CreateActionsFooter
          onAddService={() => openEditor(null)}
          onAddStack={() => openStackEditor(null)}
        />
      )}

      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        className="group absolute top-0 right-0 bottom-0 z-20 w-2 cursor-col-resize"
      >
        <div className="group-hover:bg-accent/30 group-active:bg-accent/50 absolute top-0 right-0 bottom-0 w-[2px] transition-colors" />
      </div>
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
