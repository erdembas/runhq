import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { LayoutState } from './layoutTypes';
import { createCommandLogTab, normaliseCommandNames } from './layoutLogTabs';

export function defaultLayoutState(commandNames: string[] = []): LayoutState {
  const firstTermId = 'terminal-1';
  const commands = normaliseCommandNames(commandNames);
  const logTabs = commands.length > 0 ? commands.map(createCommandLogTab) : [];
  const logTabIds = logTabs.length > 0 ? logTabs.map((tab) => tab.id) : ['logs'];
  const logTabsById =
    logTabs.length > 0
      ? Object.fromEntries(logTabs.map((tab) => [tab.id, tab]))
      : { logs: { id: 'logs', kind: 'logs' as const, title: i18n.t('Logs') } };

  return {
    root: {
      type: 'split',
      id: 'project-run-split',
      orientation: 'vertical',
      sizes: [68, 32],
      children: [
        { type: 'group', id: 'root', tabs: logTabIds, activeTab: logTabIds[0] ?? null },
        { type: 'group', id: 'project-terminals', tabs: [firstTermId], activeTab: firstTermId },
      ],
    },
    tabs: {
      ...logTabsById,
      [firstTermId]: { id: firstTermId, kind: 'terminal', title: i18n.t('Terminal 1') },
    },
    nextTermIdx: 2,
    includeDocs: false,
    knownLogCommands: commands,
    closedKinds: [],
  };
}
