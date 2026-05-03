import { useMemo } from 'react';
import { GroupTabStrip } from '../GroupTabStrip';
import { PaneDropZones } from '../PaneDropZones';
import type { GroupNode, Tab } from '../layoutModel';
import { BodySlot } from './BodySlot';
import { EmptyPaneState } from './EmptyPaneState';

interface GroupPaneProps {
  group: GroupNode;
  tabs: Record<string, Tab>;
  includeDocs: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
  onAddTerminal: () => void;
  onAddTerminalToEmpty: () => void;
  onReset: (() => void) | null;
  onSlotRef: (tabId: string, el: HTMLDivElement | null) => void;
  dragActive: boolean;
  focused: boolean;
}

export function GroupPane({
  group,
  tabs,
  includeDocs,
  onActivate,
  onClose,
  onRename,
  onAddTerminal,
  onAddTerminalToEmpty,
  onReset,
  onSlotRef,
  dragActive,
  focused,
}: GroupPaneProps) {
  const visibleIds = useMemo(
    () => group.tabs.filter((id) => tabs[id] && (tabs[id]!.kind !== 'docs' || includeDocs)),
    [group.tabs, tabs, includeDocs],
  );
  const activeTabId = useMemo(() => {
    if (group.activeTab && visibleIds.includes(group.activeTab)) return group.activeTab;
    return visibleIds[0] ?? null;
  }, [group.activeTab, visibleIds]);

  return (
    <div
      data-pane-id={group.id}
      className="bg-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <GroupTabStrip
        group={group}
        tabs={tabs}
        includeDocs={includeDocs}
        onActivate={onActivate}
        onClose={onClose}
        onRename={onRename}
        onAddTerminal={onAddTerminal}
        onReset={onReset}
        groupFocused={focused}
      />
      <div className="relative flex min-h-0 flex-1">
        {visibleIds.length === 0 ? (
          <EmptyPaneState onAddTerminal={onAddTerminalToEmpty} />
        ) : (
          visibleIds.map((tabId) => (
            <BodySlot
              key={tabId}
              tabId={tabId}
              active={tabId === activeTabId}
              onSlotRef={onSlotRef}
            />
          ))
        )}
        <PaneDropZones groupId={group.id} visible={dragActive} />
      </div>
    </div>
  );
}
