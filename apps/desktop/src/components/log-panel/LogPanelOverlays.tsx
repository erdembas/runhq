import { lazy, Suspense } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ProjectDetailDrawer, type DetailTab } from '@/components/ProjectDetailDrawer';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectOverview, ServiceDef } from '@/types';

const LicensePanel = lazy(() =>
  import('@/components/LicensePanel').then((module) => ({ default: module.LicensePanel })),
);

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

interface LogPanelOverlaysProps {
  detailTab: DetailTab | null;
  editors: ReturnType<typeof useAppStore.getState>['editors'];
  lastScanAt: number | null;
  licenseOpen: boolean;
  overviewScanning: boolean;
  pendingConfirm: PendingConfirm | null;
  projectMeta: ProjectOverview | null;
  service: ServiceDef;
  onCloseDetail: () => void;
  onCloseLicense: () => void;
  onCancelConfirm: () => void;
  onRescan: () => void;
}

export function LogPanelOverlays({
  detailTab,
  editors,
  lastScanAt,
  licenseOpen,
  overviewScanning,
  pendingConfirm,
  projectMeta,
  service,
  onCloseDetail,
  onCloseLicense,
  onCancelConfirm,
  onRescan,
}: LogPanelOverlaysProps) {
  return (
    <>
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={onCancelConfirm}
        />
      )}

      {licenseOpen && (
        <Drawer onClose={onCloseLicense} ariaLabel="License compliance" size="lg">
          <Suspense fallback={<div className="text-fg-dim p-4 text-[12px]">Loading…</div>}>
            <LicensePanel
              serviceId={service.id}
              serviceName={service.name}
              onClose={onCloseLicense}
            />
          </Suspense>
        </Drawer>
      )}

      {detailTab && projectMeta && (
        <ProjectDetailDrawer
          project={projectMeta}
          initialTab={detailTab}
          scanning={overviewScanning}
          lastScanAt={lastScanAt}
          onRescan={onRescan}
          onClose={onCloseDetail}
          onJump={(id) => {
            onCloseDetail();
            useAppStore.getState().setSelected(id);
          }}
          editors={editors}
          onOpenPath={(path) => void ipc.openPath(path)}
          onOpenUrl={(url) => void ipc.openUrl(url)}
          onOpenInEditor={async (command, path) => {
            try {
              await ipc.openInEditor(command, path);
            } catch {
              await ipc.openPath(path);
            }
          }}
        />
      )}
    </>
  );
}
