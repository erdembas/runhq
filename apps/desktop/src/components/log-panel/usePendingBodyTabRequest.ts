import { useCallback, useEffect } from 'react';
import { findGroupByTab } from '@/components/layout/layoutModel';
import type { UseServiceLayoutResult } from '@/components/layout/useServiceLayout';
import { useAppStore } from '@/store/useAppStore';

interface UsePendingBodyTabRequestArgs {
  activeCommandName: string | null;
  layout: UseServiceLayoutResult;
  serviceId: string;
}

export function usePendingBodyTabRequest({
  activeCommandName,
  layout,
  serviceId,
}: UsePendingBodyTabRequestArgs) {
  const pendingBodyTabRequest = useAppStore((s) => s.pendingServiceBodyTab[serviceId]);
  const consumePendingBodyTab = useAppStore((s) => s.consumePendingServiceBodyTab);

  const activateSingleton = useCallback(
    (tabId: 'logs' | 'docs' | 'notes') => {
      if (tabId === 'logs') {
        if (activeCommandName) layout.openCommandLog(activeCommandName);
        return;
      }
      const group = findGroupByTab(layout.state.root, tabId);
      if (group) layout.activate(group.id, tabId);
    },
    [activeCommandName, layout],
  );

  useEffect(() => {
    if (!pendingBodyTabRequest) return;
    if (pendingBodyTabRequest === 'terminal') {
      layout.ensureTerminal();
    } else if (
      pendingBodyTabRequest === 'logs' ||
      pendingBodyTabRequest === 'docs' ||
      pendingBodyTabRequest === 'notes'
    ) {
      activateSingleton(pendingBodyTabRequest);
    }
    consumePendingBodyTab(serviceId);
  }, [pendingBodyTabRequest, consumePendingBodyTab, serviceId, layout, activateSingleton]);
}
