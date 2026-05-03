import { lazy, Suspense } from 'react';
import { ProjectDetailDrawer } from '@/components/ProjectDetailDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { ipc } from '@/lib/ipc';
import type { DashboardModel } from './useDashboardModel';

const LicensePanel = lazy(() =>
  import('@/components/LicensePanel').then((m) => ({ default: m.LicensePanel })),
);

interface Props {
  model: DashboardModel;
}

export function DashboardOverlays({ model }: Props) {
  return (
    <>
      {model.pendingConfirm && (
        <ConfirmDialog
          message={model.pendingConfirm.message}
          onConfirm={model.pendingConfirm.onConfirm}
          onCancel={() => model.setPendingConfirm(null)}
        />
      )}
      {model.serviceOverlay && model.overlayService && model.serviceOverlay.kind === 'license' && (
        <Drawer onClose={model.closeServiceOverlay} ariaLabel="License compliance" size="lg">
          <Suspense fallback={<div className="text-fg-dim p-4 text-[12px]">Loading…</div>}>
            <LicensePanel
              serviceId={model.overlayService.id}
              serviceName={model.overlayService.name}
              onClose={model.closeServiceOverlay}
            />
          </Suspense>
        </Drawer>
      )}
      {model.openDetailProject && model.detail && (
        <ProjectDetailDrawer
          project={model.openDetailProject}
          initialTab={model.detail.tab}
          scanning={model.overviewScanning}
          lastScanAt={model.lastScanAt}
          onRescan={() => void model.runScan()}
          onClose={model.closeDetail}
          onJump={(id) => {
            model.closeDetail();
            model.selectService(id);
          }}
          editors={model.editors}
          onOpenPath={(path) => void ipc.openPath(path)}
          onOpenInEditor={async (command, path) => {
            try {
              await ipc.openInEditor(command, path);
            } catch {
              void ipc.openPath(path);
            }
          }}
          onOpenUrl={(url) => void ipc.openUrl(url)}
        />
      )}
    </>
  );
}
