import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { AgentNotificationSettings as Settings } from '@runhq/cockpit-ui';
import { useAgentNotificationStore } from '@/store/useAgentNotificationStore';

export function AgentNotificationSettings({
  projectId,
  projectName,
}: {
  projectId?: string;
  projectName?: string;
}) {
  i18n.useLocale();
  const preferences = useAgentNotificationStore((state) => state.preferences);
  const error = useAgentNotificationStore((state) => state.error);
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    const store = useAgentNotificationStore.getState();
    store.setError(null);
    try {
      const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
      if (granted) store.setEnabled(true);
      else
        store.setError(
          i18n.t(
            'Notifications were not enabled. You can allow RunHQ in your system notification settings.',
          ),
        );
    } catch {
      store.setError(
        i18n.t(
          'Notification permission could not be requested. Check your system notification settings.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Settings
      enabled={preferences.enabled}
      busy={busy}
      available={isTauri()}
      projectName={projectName}
      projectMuted={!!projectId && preferences.mutedProjects.includes(projectId)}
      error={error}
      onEnable={() => void enable()}
      onDisable={() => useAgentNotificationStore.getState().setEnabled(false)}
      onToggleProjectMuted={() => {
        if (projectId)
          useAgentNotificationStore
            .getState()
            .setProjectMuted(projectId, !preferences.mutedProjects.includes(projectId));
      }}
    />
  );
}
