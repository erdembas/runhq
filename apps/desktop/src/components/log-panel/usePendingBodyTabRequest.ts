import { useCallback, useEffect } from 'react';
import { findGroupByTab } from '@/components/layout/layoutModel';
import type { UseServiceLayoutResult } from '@/components/layout/useServiceLayout';
import { useAppStore } from '@/store/useAppStore';
import { openProjectSection } from '@/lib/workbenchNavigation';

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
    if (pendingBodyTabRequest === 'agents') {
      openProjectSection(serviceId, 'agents');
    } else if (pendingBodyTabRequest === 'terminal') {
      layout.ensureTerminal();
      openProjectSection(serviceId, 'run');
    } else if (pendingBodyTabRequest === 'docs' || pendingBodyTabRequest === 'notes') {
      openProjectSection(serviceId, pendingBodyTabRequest);
    } else if (pendingBodyTabRequest === 'logs') {
      activateSingleton(pendingBodyTabRequest);
      openProjectSection(serviceId, 'run');
    }
    consumePendingBodyTab(serviceId);
  }, [pendingBodyTabRequest, consumePendingBodyTab, serviceId, layout, activateSingleton]);
}
