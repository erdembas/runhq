import { findGroupByTab, insertTabIntoGroup, removeTabFromTree, updateNode } from './layoutTree';
import {
  commandLogTabId,
  createCommandLogTab,
  findCommandLogTabId,
  nextLogInsertIndex,
  normaliseCommandNames,
  preferredLogGroup,
} from './layoutLogTabs';
import type { LayoutState, Tab } from './layoutTypes';

export function syncCommandLogTabs(state: LayoutState, commands: string[]): LayoutState {
  const commandNames = normaliseCommandNames(commands);
  const commandSet = new Set(commandNames);
  let next = ensureKnownLogCommands(state);
  let changed = next !== state;

  if (commandNames.length === 0) return next;

  let root = next.root;
  let tabs = next.tabs;
  const known = new Set(next.knownLogCommands.filter((name) => commandSet.has(name)));

  for (const tab of Object.values(tabs)) {
    if (tab.kind !== 'logs' || !tab.commandName || commandSet.has(tab.commandName)) continue;
    root = removeTabFromTree(root, tab.id);
    const { [tab.id]: _removed, ...remainingTabs } = tabs;
    void _removed;
    tabs = remainingTabs;
    changed = true;
  }

  for (const tab of Object.values(tabs)) {
    if (tab.kind !== 'logs' || tab.commandName) continue;
    const commandName = commandNames.find((name) => !hasCommandLogTab(tabs, name));
    if (!commandName) {
      root = removeTabFromTree(root, tab.id);
      const { [tab.id]: _removed, ...remainingTabs } = tabs;
      void _removed;
      tabs = remainingTabs;
    } else {
      tabs = {
        ...tabs,
        [tab.id]: { ...tab, title: commandName, commandName },
      };
      known.add(commandName);
    }
    changed = true;
  }

  next = { ...next, root, tabs, knownLogCommands: Array.from(known) };

  for (const commandName of commandNames) {
    if (hasCommandLogTab(next.tabs, commandName)) {
      known.add(commandName);
      continue;
    }
    if (known.has(commandName)) continue;
    next = addCommandLogTab(next, commandName, false);
    known.add(commandName);
    changed = true;
  }

  const knownLogCommands = commandNames.filter((name) => known.has(name));
  if (knownLogCommands.join('\x1f') !== next.knownLogCommands.join('\x1f')) {
    next = { ...next, knownLogCommands };
    changed = true;
  }

  return changed ? next : state;
}

export function openCommandLogTab(state: LayoutState, commandName: string): LayoutState {
  if (!commandName) return state;
  const existingTabId = findCommandLogTabId(state, commandName);
  if (existingTabId) {
    const group = findGroupByTab(state.root, existingTabId);
    if (!group || group.activeTab === existingTabId) return state;
    const root = updateNode(state.root, group.id, (node) =>
      node.type === 'group' ? { ...node, activeTab: existingTabId } : node,
    );
    return root === state.root ? state : { ...state, root };
  }
  return addCommandLogTab(ensureKnownLogCommands(state), commandName, true);
}

function addCommandLogTab(state: LayoutState, commandName: string, activate: boolean): LayoutState {
  const group = preferredLogGroup(state);
  if (!group) return state;
  const tab = createCommandLogTab(commandName);
  const tabId = state.tabs[tab.id] ? commandLogTabId(`${commandName}:${Date.now()}`) : tab.id;
  const nextTab = tabId === tab.id ? tab : { ...tab, id: tabId };
  const insertIndex = nextLogInsertIndex(group, state.tabs);
  const root = insertTabIntoGroup(state.root, group.id, nextTab.id, insertIndex, activate);
  const known = new Set(state.knownLogCommands);
  known.add(commandName);
  return {
    ...state,
    root,
    tabs: { ...state.tabs, [nextTab.id]: nextTab },
    knownLogCommands: Array.from(known),
  };
}

function ensureKnownLogCommands(state: LayoutState): LayoutState {
  if (Array.isArray(state.knownLogCommands)) return state;
  return { ...state, knownLogCommands: [] };
}

function hasCommandLogTab(tabs: Record<string, Tab>, commandName: string): boolean {
  return Object.values(tabs).some((tab) => tab.kind === 'logs' && tab.commandName === commandName);
}
