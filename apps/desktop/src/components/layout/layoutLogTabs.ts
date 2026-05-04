import type { GroupNode, LayoutState, Tab } from './layoutTypes';
import { listGroups } from './layoutTree';

export function normaliseCommandNames(commandNames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of commandNames) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function commandLogTabId(commandName: string): string {
  return `logs:${encodeURIComponent(commandName)}`;
}

export function createCommandLogTab(commandName: string): Tab {
  return {
    id: commandLogTabId(commandName),
    kind: 'logs',
    title: commandName,
    commandName,
  };
}

export function commandNameForLogTab(tab: Tab | null | undefined): string | null {
  if (!tab || tab.kind !== 'logs') return null;
  return tab.commandName ?? null;
}

export function findCommandLogTabId(state: LayoutState, commandName: string): string | null {
  for (const tab of Object.values(state.tabs)) {
    if (tab.kind === 'logs' && tab.commandName === commandName) return tab.id;
  }
  return null;
}

export function activeCommandLogName(state: LayoutState): string | null {
  for (const group of listGroups(state.root)) {
    const commandName = commandNameForLogTab(group.activeTab ? state.tabs[group.activeTab] : null);
    if (commandName) return commandName;
  }
  return null;
}

export function preferredLogGroup(state: LayoutState): GroupNode | null {
  const groups = listGroups(state.root);
  return (
    groups.find((group) =>
      group.tabs.some((tabId) => {
        const kind = state.tabs[tabId]?.kind;
        return kind === 'logs' || kind === 'docs' || kind === 'notes';
      }),
    ) ??
    groups[0] ??
    null
  );
}

export function nextLogInsertIndex(group: GroupNode, tabs: Record<string, Tab>): number {
  let lastLogIndex = -1;
  for (let index = 0; index < group.tabs.length; index += 1) {
    const tabId = group.tabs[index];
    if (tabId && tabs[tabId]?.kind === 'logs') lastLogIndex = index;
  }
  if (lastLogIndex >= 0) return lastLogIndex + 1;

  const firstStaticIndex = group.tabs.findIndex((tabId) => {
    const kind = tabs[tabId]?.kind;
    return kind === 'docs' || kind === 'notes' || kind === 'terminal';
  });
  return firstStaticIndex >= 0 ? firstStaticIndex : group.tabs.length;
}
