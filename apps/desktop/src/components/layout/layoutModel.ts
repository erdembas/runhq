import { defaultLayoutState } from './layoutDefaults';
import {
  collapseEmptyGroups,
  findGroup,
  insertTabIntoGroup,
  removeTabFromTree,
  splitTreeAroundGroup,
  updateNode,
} from './layoutTree';
import { openCommandLogTab, syncCommandLogTabs } from './commandLogLayout';
import type { LayoutAction, LayoutState, Tab } from './layoutTypes';

export { defaultLayoutState } from './layoutDefaults';
export { activeCommandLogName, commandNameForLogTab, findCommandLogTabId } from './layoutLogTabs';
export {
  findGroupByTab,
  listGroups,
  makeGroupId,
  makeSplitId,
  preferredTerminalGroup,
} from './layoutTree';
export type {
  GroupNode,
  LayoutAction,
  LayoutNode,
  LayoutState,
  SplitEdge,
  SplitNode,
  Tab,
  TabKind,
} from './layoutTypes';

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'init':
      return action.state;

    case 'reset':
      return { ...defaultLayoutState(action.commands ?? []), includeDocs: state.includeDocs };

    case 'set-include-docs':
      if (state.includeDocs === action.includeDocs) return state;
      return { ...state, includeDocs: action.includeDocs };

    case 'activate-tab': {
      const root = updateNode(state.root, action.groupId, (n) => {
        if (n.type !== 'group') return n;
        if (!n.tabs.includes(action.tabId)) return n;
        if (n.activeTab === action.tabId) return n;
        return { ...n, activeTab: action.tabId };
      });
      return root === state.root ? state : { ...state, root };
    }

    case 'add-terminal': {
      const idx = state.nextTermIdx;
      const newId = `terminal-${idx}`;
      const newTab: Tab = {
        id: newId,
        kind: 'terminal',
        title: `Terminal ${idx}`,
      };
      const root = updateNode(state.root, action.groupId, (n) => {
        if (n.type !== 'group') return n;
        return { ...n, tabs: [...n.tabs, newId], activeTab: newId };
      });
      return {
        ...state,
        root,
        tabs: { ...state.tabs, [newId]: newTab },
        nextTermIdx: idx + 1,
      };
    }

    case 'sync-command-log-tabs':
      return syncCommandLogTabs(state, action.commands);

    case 'open-command-log-tab':
      return openCommandLogTab(state, action.commandName);

    case 'rename-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.kind !== 'terminal') return state;
      const trimmed = action.title.trim().slice(0, 40);
      if (!trimmed || trimmed === tab.title) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: { ...tab, title: trimmed } },
      };
    }

    case 'close-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab || (tab.kind !== 'terminal' && !(tab.kind === 'logs' && tab.commandName))) {
        return state;
      }
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = collapseEmptyGroups(root1);
      const { [action.tabId]: _removed, ...remainingTabs } = state.tabs;
      void _removed;
      return { ...state, root: root2, tabs: remainingTabs };
    }

    case 'move-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = insertTabIntoGroup(
        root1,
        action.targetGroupId,
        action.tabId,
        action.insertIndex,
      );
      return { ...state, root: collapseEmptyGroups(root2) };
    }

    case 'split-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      const targetGroup = findGroup(state.root, action.targetGroupId);
      if (targetGroup && targetGroup.tabs.length === 1 && targetGroup.tabs[0] === action.tabId) {
        return state;
      }
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = splitTreeAroundGroup(root1, action.targetGroupId, action.tabId, action.edge);
      return { ...state, root: collapseEmptyGroups(root2) };
    }

    case 'resize-split': {
      const root = updateNode(state.root, action.splitId, (n) => {
        if (n.type !== 'split') return n;
        return { ...n, sizes: action.sizes };
      });
      return root === state.root ? state : { ...state, root };
    }

    default:
      return state;
  }
}
