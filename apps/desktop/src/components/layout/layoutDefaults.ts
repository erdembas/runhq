import type { LayoutState } from './layoutTypes';

export function defaultLayoutState(): LayoutState {
  const firstTermId = 'terminal-1';
  return {
    root: {
      type: 'group',
      id: 'root',
      tabs: ['logs', 'docs', 'notes', firstTermId],
      activeTab: 'logs',
    },
    tabs: {
      logs: { id: 'logs', kind: 'logs', title: 'Logs' },
      docs: { id: 'docs', kind: 'docs', title: 'Docs' },
      notes: { id: 'notes', kind: 'notes', title: 'Notes' },
      [firstTermId]: { id: firstTermId, kind: 'terminal', title: 'Terminal 1' },
    },
    nextTermIdx: 2,
    includeDocs: false,
  };
}
