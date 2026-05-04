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
      : { logs: { id: 'logs', kind: 'logs' as const, title: 'Logs' } };

  return {
    root: {
      type: 'group',
      id: 'root',
      tabs: [...logTabIds, 'docs', 'notes', firstTermId],
      activeTab: logTabIds[0] ?? 'docs',
    },
    tabs: {
      ...logTabsById,
      docs: { id: 'docs', kind: 'docs', title: 'Docs' },
      notes: { id: 'notes', kind: 'notes', title: 'Notes' },
      [firstTermId]: { id: firstTermId, kind: 'terminal', title: 'Terminal 1' },
    },
    nextTermIdx: 2,
    includeDocs: false,
    knownLogCommands: commands,
  };
}
