import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, Suspense, useState } from 'react';
import { ArrowUpRight, Loader2, Package, RefreshCw, Scale, Shield } from 'lucide-react';
import { ProjectDetailDrawer, type DetailTab } from '@/components/ProjectDetailDrawer';
import { Drawer } from '@/components/ui/Drawer';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { openProjectSection } from '@/lib/workbenchNavigation';
import type { ServiceDef } from '@/types';

const LicensePanel = lazy(() =>
  import('@/components/LicensePanel').then((m) => ({ default: m.LicensePanel })),
);

export function ProjectHealth({ service, visible }: { service: ServiceDef; visible: boolean }) {
  i18n.useLocale();
  const project = useAppStore(
    (s) => s.overview?.projects.find((p) => p.service_id === service.id) ?? null,
  );
  const editors = useAppStore((s) => s.editors);
  const scanning = useAppStore((s) => s.scanningServiceIds.has(service.id));
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const [detail, setDetail] = useState<DetailTab | null>(null);
  const [license, setLicense] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rescan = async () => {
    if (scanning) return;
    const store = useAppStore.getState();
    store.setScanningService(service.id, true);
    setError(null);
    try {
      const entry = await ipc.scanProjectDependencyForService(service.id, true);
      useAppStore.getState().patchScanEntry(entry);
    } catch (cause) {
      setError(String(cause));
    } finally {
      useAppStore.getState().setScanningService(service.id, false);
    }
  };
  const metrics = [
    {
      icon: Package,
      label: i18n.t('Outdated packages'),
      value: project?.outdated?.total,
      action: i18n.t('Review outdated packages'),
      onClick: () => setDetail('outdated'),
      disabled: !project,
    },
    {
      icon: Shield,
      label: i18n.t('Security advisories'),
      value: project?.audit?.advisories.length,
      action: i18n.t('Review security advisories'),
      onClick: () => setDetail('advisories'),
      disabled: !project,
    },
    {
      icon: Scale,
      label: i18n.t('License warnings'),
      value: project?.license
        ? project.license.strong_copyleft_count +
          project.license.network_copyleft_count +
          project.license.proprietary_count
        : undefined,
      action: i18n.t('Review licenses'),
      onClick: () => setLicense(true),
      disabled: false,
    },
  ];
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="overflow-y-auto p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-fg text-2xl font-semibold tracking-tight">
                {i18n.t('Project health')}
              </h1>
              <p className="text-fg-muted mt-2 text-[13px]">{service.name}</p>
            </div>
            <button
              type="button"
              onClick={() => void rescan()}
              disabled={scanning}
              className="border-border hover:bg-surface-raised text-fg flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {scanning ? i18n.t('Scanning…') : i18n.t('Scan project dependencies')}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-status-error mb-4 text-sm">
              {i18n.t('Could not scan project: {message}', { message: error })}
            </p>
          )}
          {!project?.outdated && !project?.audit && (
            <p className="text-fg-muted mb-5 text-sm">
              {i18n.t('Dependencies have not been scanned yet.')}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {metrics.map(({ icon: Icon, label, value, action, onClick, disabled }) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={onClick}
                className="border-border bg-surface-raised/40 hover:border-accent/35 flex flex-col items-start rounded-xl border p-5 text-left transition disabled:opacity-50"
              >
                <Icon className="text-fg-muted mb-5 h-5 w-5" />
                <span className="text-fg text-[13px] font-medium">{label}</span>
                <span className="text-fg my-3 text-3xl font-semibold tabular-nums">
                  {value == null ? i18n.t('Not scanned') : i18n.number(value)}
                </span>
                <span className="text-fg-muted mt-auto flex items-center gap-1 text-xs">
                  {action}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {visible && detail && project && (
        <ProjectDetailDrawer
          project={project}
          initialTab={detail}
          scanning={scanning}
          lastScanAt={lastScanAt}
          editors={editors}
          onRescan={() => void rescan()}
          onClose={() => setDetail(null)}
          onJump={(id) => openProjectSection(id, 'run')}
          onOpenPath={(path) => void ipc.openPath(path)}
          onOpenUrl={(url) => void ipc.openUrl(url)}
          onOpenInEditor={(command, path) =>
            void ipc.openInEditor(command, path).catch(() => ipc.openPath(path))
          }
        />
      )}
      {visible && license && (
        <Drawer
          onClose={() => setLicense(false)}
          ariaLabel={i18n.t('License compliance')}
          size="lg"
        >
          <Suspense fallback={<p className="text-fg-muted p-4">{i18n.t('Loading…')}</p>}>
            <LicensePanel
              serviceId={service.id}
              serviceName={service.name}
              onClose={() => setLicense(false)}
            />
          </Suspense>
        </Drawer>
      )}
    </div>
  );
}
