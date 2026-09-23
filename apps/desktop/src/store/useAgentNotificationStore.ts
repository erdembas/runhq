import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { create } from 'zustand';
import {
  readAgentNotificationPreferences,
  type AgentNotificationPreferences,
} from '@/components/agents/agentNotifications';

const STORAGE_KEY = 'runhq.agent-notifications.v1';
function loadPreferences() {
  try {
    return readAgentNotificationPreferences(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readAgentNotificationPreferences(null);
  }
}
interface AgentNotificationStore {
  preferences: AgentNotificationPreferences;
  error: string | null;
  setEnabled: (enabled: boolean) => void;
  setProjectMuted: (projectId: string, muted: boolean) => void;
  setError: (error: string | null) => void;
}
export const useAgentNotificationStore = create<AgentNotificationStore>((set, get) => {
  const save = (preferences: AgentNotificationPreferences) => {
    // Disabling or muting must take effect immediately, even if storage is full.
    set({ preferences });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
      set({ error: null });
    } catch {
      set({
        error: i18n.t(
          'These notification settings apply for this session, but could not be saved. Free local storage and try again.',
        ),
      });
    }
  };
  return {
    preferences: loadPreferences(),
    error: null,
    setEnabled: (enabled) => save({ ...get().preferences, enabled }),
    setProjectMuted: (projectId, muted) => {
      const current = get().preferences;
      save({
        ...current,
        mutedProjects: muted
          ? [...new Set([...current.mutedProjects, projectId])]
          : current.mutedProjects.filter((id) => id !== projectId),
      });
    },
    setError: (error) => set({ error }),
  };
});
