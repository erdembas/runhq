import * as i18n from '@runhq/cockpit-ui/i18n';
import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppDataBootstrap } from '@/components/app/useAppDataBootstrap';
import { useAppKeyboardShortcuts } from '@/components/app/useAppKeyboardShortcuts';
import { useAppViewShortcuts } from '@/components/app/useAppViewShortcuts';
import { useOpenAiSettingsEvent } from '@/components/app/useOpenAiSettingsEvent';
import { usePortPolling } from '@/components/app/usePortPolling';
import { useProjectOverviewPolling } from '@/components/app/useProjectOverviewPolling';
import { useQuickActionEvents } from '@/components/app/useQuickActionEvents';
import { AppShell } from '@/components/app/AppShell';
import { useSupervisorEvents } from '@/components/app/useSupervisorEvents';
import { useTrayHint } from '@/components/app/useTrayHint';
import { useWhatsNewAutoOpen } from '@/components/app/useWhatsNewAutoOpen';
import { useAgentNotifications } from '@/components/app/useAgentNotifications';
import { useAgentSchedules } from '@/components/app/useAgentSchedules';
import { useAgentAccountCooldowns } from '@/components/app/useAgentAccountCooldowns';
import { useAppStore } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';
import { useContextMenu } from '@/lib/context-menu';
import { useUiZoomShortcuts } from '@/lib/ui-zoom';

export default function App() {
  i18n.useLocale();
  const openEditor = useAppStore((s) => s.openEditor);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setScanPath = useShellUiStore((s) => s.setScanPath);

  const startScan = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') setScanPath(picked);
  }, [setScanPath]);

  const contextItems = useCallback(
    (): Array<{ label: string; action?: () => void; separator?: boolean; shortcut?: string }> => [
      { label: i18n.t('New Service…'), action: () => openEditor(null), shortcut: '⌘N' },
      { label: i18n.t('New Stack…'), action: () => openStackEditor(null) },
      { label: i18n.t('Discover projects…'), action: startScan },
      { separator: true, label: '' },
      {
        label: i18n.t('Reload'),
        action: () => window.location.reload(),
      },
    ],
    [openEditor, openStackEditor, startScan],
  );
  const { menu: contextMenu } = useContextMenu(contextItems);
  useUiZoomShortcuts();
  useSupervisorEvents();
  useAppViewShortcuts();
  useAppDataBootstrap();
  usePortPolling();
  useProjectOverviewPolling();
  useQuickActionEvents(startScan);
  useOpenAiSettingsEvent();
  useTrayHint();
  useWhatsNewAutoOpen();
  useAppKeyboardShortcuts();
  useAgentNotifications();
  useAgentSchedules();
  useAgentAccountCooldowns();

  return <AppShell contextMenu={contextMenu} startScan={startScan} />;
}
