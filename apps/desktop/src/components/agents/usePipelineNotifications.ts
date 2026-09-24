import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { agentPipelineIpc } from '@/lib/ipc/agentPipelineIpc';
import { useAgentNotificationStore } from '@/store/useAgentNotificationStore';

/** Package approvals and command failures may have no corresponding agent session. */
export function usePipelineNotifications() {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let pending = false;
    let previous: Map<string, string> | undefined;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const rows = await agentPipelineIpc.list();
        if (disposed) return;
        const current = new Map(rows.map((r) => [r.id, `${r.state}:${r.attention}`]));
        const before = previous;
        previous = current;
        if (!before) return;
        const changed = rows.filter(
          (r) =>
            r.notify_human &&
            ['awaiting_approval', 'halted'].includes(r.state) &&
            before.get(r.id) !== current.get(r.id),
        );
        if (!changed.length || !useAgentNotificationStore.getState().preferences.enabled) return;
        if (!(await isPermissionGranted()) || disposed) return;
        const preferences = useAgentNotificationStore.getState().preferences;
        if (
          !preferences.enabled ||
          !changed.some((r) => !preferences.mutedProjects.includes(r.project_id))
        )
          return;
        await invoke('plugin:notification|notify', {
          options: {
            title: i18n.t('Pipeline package needs attention'),
            body: i18n.t('Open Pipeline packages to review an approval or a stopped step.'),
          },
        });
      } catch {
        // Transient polling errors must not generate spurious halt notifications.
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
}
