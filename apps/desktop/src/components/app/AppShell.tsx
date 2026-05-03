import type { CSSProperties, ReactNode } from 'react';
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
import { useAppStore, mainTabKey } from '@/store/useAppStore';
import { useShellUiStore } from '@/store/useShellUiStore';

interface AppShellProps {
  contextMenu: ReactNode;
  startScan: () => Promise<void>;
}

export function AppShell({ contextMenu, startScan }: AppShellProps) {
  const mainTabs = useAppStore((s) => s.mainTabs);
  const activeMainTabKey = useAppStore((s) => s.activeMainTabKey);
  const editorService = useAppStore((s) => s.editorService);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const editorStack = useAppStore((s) => s.editorStack);
  const closeStackEditor = useAppStore((s) => s.closeStackEditor);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const diffViewerOpen = useAppStore((s) => s.diffViewerOpen);
  const diffViewerServiceId = useAppStore((s) => s.diffViewerServiceId);
  const closeDiffViewer = useAppStore((s) => s.closeDiffViewer);
  const crossProjectDiffOpen = useAppStore((s) => s.crossProjectDiffOpen);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);
  const whatsNewOpen = useAppStore((s) => s.whatsNewOpen);
  const whatsNewVersion = useAppStore((s) => s.whatsNewVersion);
  const closeWhatsNew = useAppStore((s) => s.closeWhatsNew);
  const openSettings = useAppStore((s) => s.openSettings);
  const scanPath = useShellUiStore((s) => s.scanPath);
  const setScanPath = useShellUiStore((s) => s.setScanPath);
  const portManagerOpen = useShellUiStore((s) => s.portManagerOpen);
  const openPortManager = useShellUiStore((s) => s.openPortManager);
  const closePortManager = useShellUiStore((s) => s.closePortManager);
  const paletteOpen = useShellUiStore((s) => s.paletteOpen);
  const tourState = useShellUiStore((s) => s.tourState);
  const openTourReplay = useShellUiStore((s) => s.openTourReplay);
  const closeTour = useShellUiStore((s) => s.closeTour);

  return (
    <div className="bg-surface text-fg relative flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <MainTabBar />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {mainTabs.map((tab) => {
              const key = mainTabKey(tab);
              const isActive = key === activeMainTabKey;
              const style: CSSProperties = isActive
                ? { display: 'flex', flex: '1 1 auto', minHeight: 0 }
                : { display: 'none' };

              return (
                <div
                  key={key}
                  role="tabpanel"
                  aria-hidden={!isActive}
                  className="flex-col overflow-hidden"
                  style={style}
                >
                  {tab.kind === 'dashboard' && <Dashboard onScan={startScan} />}
                  {tab.kind === 'service' && <LogPanel serviceId={tab.refId} />}
                  {tab.kind === 'stack' && <StackDetail stackId={tab.refId} />}
                  {tab.kind === 'settings' && (
                    <SettingsView
                      onReplayTour={() => {
                        useAppStore.getState().closeSettings();
                        openTourReplay();
                      }}
                    />
                  )}
                  {tab.kind === 'release-notes' && <ReleaseNotes />}
                </div>
              );
            })}
          </div>
        </main>
        <RightSidePanel />
        <RightActivityBar />
      </div>

      <UpdateBanner />
      <StatusBar
        onOpenPortManager={openPortManager}
        onOpenSettings={() => openSettings('shortcuts')}
        onOpenAiSettings={() => openSettings('ai')}
        onToggleAiChat={() => toggleRightPanel('ai')}
      />

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
      <ResizeHandles />

      {paletteOpen && (
        <div
          aria-hidden
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] transition-opacity duration-150"
          onClick={() => void ipc.hideQuickAction().catch(() => {})}
        />
      )}
      {contextMenu}
      <GlobalTooltip />
    </div>
  );
}
