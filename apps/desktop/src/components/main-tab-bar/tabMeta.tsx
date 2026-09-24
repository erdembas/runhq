import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { Bot, LayoutDashboard, Layers, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { MainTab } from '@/store/useAppStore';
import { useAppStore } from '@/store/useAppStore';
import type { Status } from '@/types';
import type { AgentWorkspaceView } from '@/store/useWorkbenchStore';

export interface TabMeta {
  label: string;
  icon: React.ReactNode;
  status?: Status;
  closable: boolean;
}

type AppState = ReturnType<typeof useAppStore.getState>;

export function resolveTabMeta(
  tab: MainTab,
  services: AppState['services'],
  stacks: AppState['stacks'],
  statuses: AppState['statuses'],
  agentView: AgentWorkspaceView = 'overview',
): TabMeta {
  if (tab.kind === 'agents')
    return {
      label:
        agentView === 'workflows'
          ? i18n.t('Workflows')
          : agentView === 'library'
            ? i18n.t('Library')
            : agentView === 'inbox'
              ? i18n.t('Attention center')
              : agentView === 'usage'
                ? i18n.t('Usage')
                : i18n.t('Tasks'),
      icon: <Bot className="h-3 w-3" />,
      closable: true,
    };
  if (tab.kind === 'agent-task') {
    return {
      // Compatibility metadata only: legacy tabs are never rendered by the main strip.
      label: i18n.t('Agents'),
      icon: <Bot className="h-3 w-3" />,
      closable: true,
    };
  }
  if (tab.kind === 'dashboard') {
    return {
      label: i18n.t('Overview'),
      icon: <LayoutDashboard className="h-3 w-3" />,
      closable: false,
    };
  }

  if (tab.kind === 'settings') {
    return {
      label: i18n.t('Settings'),
      icon: <SettingsIcon className="h-3 w-3" />,
      closable: true,
    };
  }

  if (tab.kind === 'release-notes') {
    return {
      label: i18n.t('Release Notes'),
      icon: <Sparkles className="h-3 w-3" />,
      closable: true,
    };
  }

  if (tab.kind === 'service') {
    const service = services.find((item) => item.id === tab.refId);
    return {
      label: service?.name ?? i18n.t('Unknown service'),
      icon: null,
      status: (statuses[tab.refId]?.status ?? 'stopped') as Status,
      closable: true,
    };
  }

  const stack = stacks.find((item) => item.id === tab.refId);
  return {
    label: stack?.name ?? i18n.t('Unknown stack'),
    icon: <Layers className="h-3 w-3" />,
    closable: true,
  };
}
