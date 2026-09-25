import { useEffect, useRef } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { useAgentNotificationStore } from '@/store/useAgentNotificationStore';
import { useAgentWorkflowAttention } from './useAgentWorkflowAttention';

/** Workflow gates and shell failures have no waiting agent session to notify from. */
export function useWorkflowNotifications() {
  const { entries, loading } = useAgentWorkflowAttention(isTauri());
  const previous = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!isTauri() || loading) return;
    const current = new Map(
      entries
        .filter((e) => e.kind !== 'apply')
        .map((e) => [e.workflow.id, `${e.kind}:${e.detail ?? ''}`]),
    );
    const before = previous.current;
    previous.current = current;
    if (!before) return;
    const actionable = entries.filter(
      (e) => current.has(e.workflow.id) && before.get(e.workflow.id) !== current.get(e.workflow.id),
    );
    if (!actionable.length) return;
    let disposed = false;
    void (async () => {
      const settings = useAgentNotificationStore.getState();
      if (!settings.preferences.enabled || !(await isPermissionGranted()) || disposed) return;
      const preferences = useAgentNotificationStore.getState().preferences;
      if (
        !preferences.enabled ||
        !actionable.some(
          (e) =>
            e.workflow.context?.notify_human !== false &&
            !preferences.mutedProjects.includes(e.workflow.project_id),
        )
      )
        return;
      await invoke('plugin:notification|notify', {
        options: {
          title: i18n.t('Workflow needs attention'),
          body: i18n.t('This workflow needs attention. Open Workflows to review the result.'),
        },
      });
    })().catch(() => {
      if (!disposed)
        useAgentNotificationStore
          .getState()
          .setError(
            i18n.t(
              'A notification could not be delivered. Check your system notification settings.',
            ),
          );
    });
    return () => {
      disposed = true;
    };
  }, [entries, loading]);
}
