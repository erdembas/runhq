import * as i18n from '@runhq/cockpit-ui/i18n';
import type { ReactNode } from 'react';
import { memo, useEffect } from 'react';
import { AgentToolsHub } from '@/components/agents/AgentToolsHub';
import { AgentWorkspace } from '@/components/agents/AgentWorkspace';
import { connectAgents } from '@/store/useAgentStore';
import { UpdateBanner } from '@/components/UpdateBanner';
import { SidebarRail } from '@/components/SidebarRail';
import { LogPanel } from '@/components/LogPanel';
import { PortManager } from '@/components/PortManager';
import { Dashboard } from '@/components/dashboard';
import { ServiceEditor } from '@/components/ServiceEditor';
import { StackEditor } from '@/components/StackEditor';
import { StackDetail } from '@/components/StackDetail';
import { MainTabBar } from '@/components/MainTabBar';
import { ScanDialog } from '@/components/ScanDialog';
import { SettingsView } from '@/components/settings/SettingsView';
import { RightActivityBar } from '@/components/RightActivityBar';
import { RightSidePanel } from '@/components/RightSidePanel';
import { ResizeHandles } from '@/components/ResizeHandles';
import { StatusBar } from '@/components/StatusBar';
import { TitleBar } from '@/components/TitleBar';
import { WelcomeTour } from '@/components/WelcomeTour';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { ReleaseNotes } from '@/components/ReleaseNotes';
import { DiffViewer } from '@/components/DiffViewer';
import { CrossProjectDiffViewer } from '@/components/CrossProjectDiffViewer';
import { GlobalTooltip } from '@/components/ui/GlobalTooltip';
import { ipc } from '@/lib/ipc';
import { useAppStore, mainTabKey, type MainTab } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';

interface AppShellProps {
  contextMenu: ReactNode;
  startScan: () => Promise<void>;
}

export function AppShell({ contextMenu, startScan }: AppShellProps) {
  i18n.useLocale();
  useEffect(() => {
    void connectAgents();
  }, []);

  return (
    <div className="bg-surface text-fg relative flex h-screen flex-col overflow-hidden">
      <WorkspaceChrome startScan={startScan} />
      <AgentToolsHub />
      <AppOverlays />
      <ResizeHandles />
      {contextMenu}
      <GlobalTooltip />
    </div>
  );
}

// Modal and context-menu state must not reconcile every mounted editor/terminal.
const WorkspaceChrome = memo(function WorkspaceChrome({
  startScan,
}: Pick<AppShellProps, 'startScan'>) {
  i18n.useLocale();
  const openPortManager = useShellUiStore((s) => s.openPortManager);
  return (
    <>
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <MainTabBar />
          <MainTabPanels startScan={startScan} />
        </main>
        <RightSidePanel />
        <RightActivityBar />
      </div>
      <UpdateBanner />
      <StatusBar
        onOpenPortManager={openPortManager}
        onOpenSettings={() => useAppStore.getState().openSettings('shortcuts')}
        onOpenAiSettings={() => useAppStore.getState().openSettings('ai')}
        onToggleAiChat={() => useAppStore.getState().toggleRightPanel('ai')}
      />
    </>
  );
});

function MainTabPanels({ startScan }: Pick<AppShellProps, 'startScan'>) {
  i18n.useLocale();
  const mainTabs = useAppStore((s) => s.mainTabs);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {mainTabs.map((tab) => (
        <MainTabPanel key={mainTabKey(tab)} tab={tab} startScan={startScan} />
      ))}
    </div>
  );
}

// Switching a tab updates only the previous and next panels. All other mounted
// panels retain their DOM, local state and terminal sessions without a render.
const MainTabPanel = memo(function MainTabPanel({
  tab,
  startScan,
}: Pick<AppShellProps, 'startScan'> & { tab: MainTab }) {
  i18n.useLocale();
  const key = mainTabKey(tab);
  const isActive = useAppStore((s) => s.activeMainTabKey === key);
  return (
    <div
      role="tabpanel"
      aria-hidden={!isActive}
      className={isActive ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}
    >
      {tab.kind === 'dashboard' && <Dashboard onScan={startScan} visible={isActive} />}
      {tab.kind === 'agents' && <AgentWorkspace visible={isActive} />}
      {tab.kind === 'service' && <LogPanel serviceId={tab.refId} isActive={isActive} />}
      {tab.kind === 'stack' && <StackDetail stackId={tab.refId} visible={isActive} />}
      {tab.kind === 'settings' && <SettingsView onReplayTour={replayTour} />}
      {tab.kind === 'release-notes' && <ReleaseNotes />}
    </div>
  );
});

function replayTour() {
  useAppStore.getState().closeSettings();
  useShellUiStore.getState().openTourReplay();
}

function AppOverlays() {
  i18n.useLocale();
  const editorService = useAppStore((s) => s.editorService);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const editorStack = useAppStore((s) => s.editorStack);
  const closeStackEditor = useAppStore((s) => s.closeStackEditor);
  const diffViewerOpen = useAppStore((s) => s.diffViewerOpen);
  const diffViewerServiceId = useAppStore((s) => s.diffViewerServiceId);
  const closeDiffViewer = useAppStore((s) => s.closeDiffViewer);
  const crossProjectDiffOpen = useAppStore((s) => s.crossProjectDiffOpen);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);
  const whatsNewOpen = useAppStore((s) => s.whatsNewOpen);
  const whatsNewVersion = useAppStore((s) => s.whatsNewVersion);
  const closeWhatsNew = useAppStore((s) => s.closeWhatsNew);
  const scanPath = useShellUiStore((s) => s.scanPath);
  const setScanPath = useShellUiStore((s) => s.setScanPath);
  const portManagerOpen = useShellUiStore((s) => s.portManagerOpen);
  const closePortManager = useShellUiStore((s) => s.closePortManager);
  const paletteOpen = useShellUiStore((s) => s.paletteOpen);
  const tourState = useShellUiStore((s) => s.tourState);
  const closeTour = useShellUiStore((s) => s.closeTour);

  return (
    <>
      {editorService !== undefined && (
        <ServiceEditor service={editorService} onClose={closeEditor} />
      )}
      {editorStack !== undefined && <StackEditor stack={editorStack} onClose={closeStackEditor} />}
      {scanPath && <ScanDialog path={scanPath} onClose={() => setScanPath(null)} />}
      {portManagerOpen && <PortManager onClose={closePortManager} />}
      {diffViewerOpen && diffViewerServiceId && (
        <DiffViewer serviceId={diffViewerServiceId} onClose={closeDiffViewer} />
      )}
      {crossProjectDiffOpen && <CrossProjectDiffViewer onClose={closeCrossProjectDiff} />}
      {tourState.open && <WelcomeTour reopened={tourState.reopened} onClose={closeTour} />}
      {whatsNewOpen && whatsNewVersion && (
        <WhatsNewModal version={whatsNewVersion} onClose={closeWhatsNew} />
      )}
      {paletteOpen && (
        <div
          aria-hidden
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/40"
          onClick={() => void ipc.hideQuickAction().catch(() => {})}
        />
      )}
    </>
  );
}
