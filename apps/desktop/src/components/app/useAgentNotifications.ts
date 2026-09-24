import { usePipelineNotifications } from '../agents/usePipelineNotifications';
import { useWorkflowNotifications } from '../agents/useWorkflowNotifications';
import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import { useAgentStore } from '@/store/useAgentStore';
import { useAgentNotificationStore } from '@/store/useAgentNotificationStore';
import { useAppStore } from '@/store/useAppStore';
import {
  agentNotificationMessage,
  createAgentNotificationTracker,
  relevantAgentNotifications,
  type AgentNotificationEvent,
} from '../agents/agentNotifications';

export function useAgentNotifications() {
  useWorkflowNotifications();
  usePipelineNotifications();
  useEffect(() => {
    if (!isTauri()) return;
    const track = createAgentNotificationTracker();
    let queued: AgentNotificationEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const viewedSession = () =>
      document.hasFocus() && useAppStore.getState().activeMainTabKey === 'agents:agents'
        ? useAgentStore.getState().selectedId
        : null;
    const deliver = async () => {
      const batch = queued;
      queued = [];
      timer = undefined;
      const current = useAgentStore.getState();
      const events = relevantAgentNotifications(
        batch,
        current.sessions,
        useAgentNotificationStore.getState().preferences,
        viewedSession(),
      );
      if (!events.length) return;
      try {
        // Permission is requested only from the explicit Enable notifications button.
        if (!(await isPermissionGranted())) {
          if (!disposed)
            useAgentNotificationStore
              .getState()
              .setError(
                i18n.t(
                  'Notifications are blocked by your system. Enable them for RunHQ in notification settings.',
                ),
              );
          return;
        }
        if (disposed) return;
        // Check again after the permission round trip: mute, read and disable take effect immediately.
        const stillRelevant = relevantAgentNotifications(
          events,
          useAgentStore.getState().sessions,
          useAgentNotificationStore.getState().preferences,
          viewedSession(),
        );
        if (!stillRelevant.length) return;
        // Await the native command; sendNotification's void browser shim cannot report delivery errors.
        await invoke('plugin:notification|notify', {
          options: agentNotificationMessage(stillRelevant),
        });
      } catch {
        if (!disposed)
          useAgentNotificationStore
            .getState()
            .setError(
              i18n.t(
                'A notification could not be delivered. Check your system notification settings.',
              ),
            );
      }
    };
    const consume = (state: ReturnType<typeof useAgentStore.getState>) => {
      const events = track(state.sessions, state.ready);
      const permitted = relevantAgentNotifications(
        events,
        state.sessions,
        useAgentNotificationStore.getState().preferences,
      );
      if (!permitted.length) return;
      queued.push(...permitted);
      // Coalesce simultaneous agents without delaying decision prompts for long.
      if (!timer) timer = setTimeout(() => void deliver(), 500);
    };
    consume(useAgentStore.getState());
    const unsubscribe = useAgentStore.subscribe(consume);
    return () => {
      disposed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
