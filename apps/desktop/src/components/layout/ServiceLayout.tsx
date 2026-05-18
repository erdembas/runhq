import { useCallback, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { findGroupByTab, type LayoutNode, type SplitEdge } from './layoutModel';
import type { UseServiceLayoutResult } from './useServiceLayout';
import { GroupPane } from './service-layout/GroupPane';
import { SplitPane } from './service-layout/SplitPane';
import { useFocusedGroup } from './service-layout/useFocusedGroup';

interface Props {
  layout: UseServiceLayoutResult;
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
  onAddTerminalToEmpty: (groupId: string) => void;
}

interface DragState {
  tabId: string;
  sourceGroupId: string;
}

export function ServiceLayout({ layout, onSlotRef, onAddTerminalToEmpty }: Props) {
  const {
    state,
    activate,
    addTerminal,
    closeTab,
    restoreTab,
    renameTab,
    moveTab,
    splitTab,
    resizeSplit,
    reset,
  } = layout;
  const [drag, setDrag] = useState<DragState | null>(null);
  const { containerRef, focusedGroupId } = useFocusedGroup(state.root);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | { kind: 'tab'; tabId: string; sourceGroupId: string }
      | undefined;
    if (data?.kind !== 'tab') return;
    setDrag({ tabId: data.tabId, sourceGroupId: data.sourceGroupId });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDrag(null);
      const active = event.active.data.current as
        | { kind: 'tab'; tabId: string; sourceGroupId: string }
        | undefined;
      const over = event.over?.data.current as
        | { kind: 'tab-slot'; groupId: string; insertIndex: number }
        | { kind: 'pane-edge'; groupId: string; edge: SplitEdge }
        | { kind: 'pane-center'; groupId: string }
        | undefined;
      if (!active || active.kind !== 'tab' || !over) return;
      const { tabId, sourceGroupId } = active;

      if (over.kind === 'tab-slot') {
        let insertIndex = over.insertIndex;
        if (over.groupId === sourceGroupId) {
          const sourceGroup = findGroupByTab(state.root, tabId);
          if (sourceGroup) {
            const currentIdx = sourceGroup.tabs.indexOf(tabId);
            if (currentIdx >= 0 && currentIdx < insertIndex) insertIndex -= 1;
            if (currentIdx === insertIndex) return;
          }
        }
        moveTab(tabId, over.groupId, insertIndex);
      } else if (over.kind === 'pane-center') {
        if (over.groupId === sourceGroupId) return;
        moveTab(tabId, over.groupId);
      } else if (over.kind === 'pane-edge') {
        splitTab(tabId, over.groupId, over.edge);
      }
    },
    [moveTab, splitTab, state.root],
  );

  const renderNode = useCallback(
    (node: LayoutNode, isRoot: boolean): React.ReactNode => {
      if (node.type === 'group') {
        return (
          <GroupPane
            key={node.id}
            group={node}
            tabs={state.tabs}
            includeDocs={state.includeDocs}
            onActivate={(tabId) => activate(node.id, tabId)}
            onClose={closeTab}
            onRename={renameTab}
            onAddTerminal={() => addTerminal(node.id)}
            onAddTerminalToEmpty={() => onAddTerminalToEmpty(node.id)}
            onReset={isRoot ? reset : null}
            closedKinds={state.closedKinds}
            onRestore={isRoot ? restoreTab : null}
            onSlotRef={onSlotRef}
            dragActive={drag !== null}
            focused={focusedGroupId === node.id}
          />
        );
      }
      return (
        <SplitPane
          key={node.id}
          node={node}
          renderChild={(child) => renderNode(child, false)}
          onResize={resizeSplit}
        />
      );
    },
    [
      activate,
      addTerminal,
      closeTab,
      restoreTab,
      drag,
      focusedGroupId,
      onAddTerminalToEmpty,
      onSlotRef,
      renameTab,
      reset,
      resizeSplit,
      state.closedKinds,
      state.includeDocs,
      state.tabs,
    ],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        {renderNode(state.root, true)}
      </div>
    </DndContext>
  );
}
