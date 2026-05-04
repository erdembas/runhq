/**
 * Tab strip for a single layout group. Drag source per tab,
 * drop targets per tab gap (reorder / insert into this group).
 *
 * Pane-level drop targets (split-on-edge) live in `PaneDropZones`,
 * which overlays each group's body during an active drag.
 */

import { Plus, RotateCcw } from 'lucide-react';

import { TabEndSlot } from './TabEndSlot';
import { TabStripAction } from './TabStripAction';
import { TabStripItem } from './TabStripItem';
import type { GroupNode, Tab } from './layoutModel';

interface Props {
  group: GroupNode;
  tabs: Record<string, Tab>;
  /** Hide the docs tab without forgetting where it lives. */
  includeDocs: boolean;
  /** Currently-active tab id of the group, drives the underline. */
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
  onAddTerminal: () => void;
  /** Reset the layout for the whole service. Header-level. Only the
   *  *root* group renders this affordance; passing `null` for the
   *  non-root groups suppresses the button. */
  onReset: (() => void) | null;
  /** This group's pane currently owns keyboard focus. Tabs in a
   *  focused pane render with a brighter accent fill so the user
   *  can locate "where my next keystroke goes" at a glance even
   *  with multiple terminals visible side-by-side. */
  groupFocused: boolean;
}

export function GroupTabStrip({
  group,
  tabs,
  includeDocs,
  onActivate,
  onClose,
  onRename,
  onAddTerminal,
  onReset,
  groupFocused,
}: Props) {
  const visibleIds = group.tabs.filter((id) => {
    const t = tabs[id];
    if (!t) return false;
    if (t.kind === 'docs' && !includeDocs) return false;
    return true;
  });

  return (
    <div
      className="border-border/60 bg-surface flex shrink-0 items-stretch border-b"
      data-group-id={group.id}
    >
      <div className="scrollbar-none flex flex-1 items-stretch overflow-x-auto">
        {visibleIds.map((tabId, idx) => {
          const tab = tabs[tabId]!;
          return (
            <TabStripItem
              key={tabId}
              tab={tab}
              groupId={group.id}
              insertIndex={idx}
              active={tab.id === group.activeTab}
              groupFocused={groupFocused}
              onActivate={onActivate}
              onClose={onClose}
              onRename={onRename}
            />
          );
        })}
        {/* Trailing drop slot: catches drops past the last tab so a
            user dragging "to the end of this strip" doesn't have to
            land precisely on the previous tab's right half. */}
        <TabEndSlot groupId={group.id} insertIndex={visibleIds.length} />
      </div>
      <div className="border-border/60 flex shrink-0 items-center gap-1 border-l px-2">
        {/* Trailing strip actions. Captioned (icon + label) instead
            of icon-only because both buttons land on the END of
            the tab strip — a region where users skim text more
            than icons. The previous icon-only "+" + "↻" pair was
            mistaken for tab decorations more than once during
            usability checks; the captions break that ambiguity. */}
        <TabStripAction
          icon={<Plus className="h-3 w-3" />}
          label="New Terminal"
          title="New terminal in this pane"
          onClick={onAddTerminal}
        />
        {onReset && (
          <TabStripAction
            icon={<RotateCcw className="h-3 w-3" />}
            label="Reset Layout"
            title="Reset layout to default"
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}
