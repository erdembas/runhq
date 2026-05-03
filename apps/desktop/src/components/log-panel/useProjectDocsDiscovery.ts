import { useEffect } from 'react';
import { findGroupByTab } from '@/components/layout/layoutModel';
import type { useServiceLayout } from '@/components/layout/useServiceLayout';
import { ipc } from '@/lib/ipc';
import { logKey, useAppStore } from '@/store/useAppStore';

interface UseProjectDocsDiscoveryArgs {
  selectedId: string | null;
  activeCmd: string | null;
  layout: ReturnType<typeof useServiceLayout>;
}

export function useProjectDocsDiscovery({
  selectedId,
  activeCmd,
  layout,
}: UseProjectDocsDiscoveryArgs) {
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    layout.setIncludeDocs(false);
    ipc
      .discoverProjectDocs(selectedId)
      .then((list) => {
        if (!alive) return;
        const present = list.length > 0;
        layout.setIncludeDocs(present);
        if (present) {
          const logsKey = activeCmd ? logKey(selectedId, activeCmd) : '';
          const linesNow = logsKey ? (useAppStore.getState().logs[logsKey]?.lines.length ?? 0) : 0;
          if (linesNow === 0) {
            const docsGroup = findGroupByTab(layout.state.root, 'docs');
            if (docsGroup) layout.activate(docsGroup.id, 'docs');
          }
        }
      })
      .catch((err) => {
        if (!alive) return;
        console.warn('docs: discover probe failed', err);
        layout.setIncludeDocs(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
}
