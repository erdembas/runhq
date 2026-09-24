import { mainTabKey, type MainTab } from '@/store/types/mainTabTypes';

/** Old task tabs are migrated before they can appear as a second conversation surface. */
export function visibleMainTabs(tabs: MainTab[]): MainTab[] {
  return tabs.some((tab) => tab.kind === 'agent-task')
    ? tabs.filter((tab) => tab.kind !== 'agent-task')
    : tabs;
}

export function migrateLegacyAgentTaskTabs(
  tabs: MainTab[],
  activeKey: string,
  openTask: (sessionId: string) => void,
  closeTab: (key: string) => void,
) {
  const legacy = tabs.filter((tab) => tab.kind === 'agent-task');
  const active = legacy.find((tab) => mainTabKey(tab) === activeKey);
  // Navigate first so closing the obsolete active tab cannot activate a neighbour.
  if (active) openTask(active.refId);
  for (const tab of legacy) closeTab(mainTabKey(tab));
}
