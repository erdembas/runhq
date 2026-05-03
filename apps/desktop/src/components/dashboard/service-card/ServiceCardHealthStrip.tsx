import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import {
  AuditChip,
  LicenseChip,
  OutdatedChip,
  licenseContaminationCount,
} from '@/components/dashboard/healthChips';
import type { ProjectOverview, ServiceId } from '@/types';
import { ScanDeltaBadge } from './ScanDeltaBadge';
import { ScanFreshnessChip } from './ScanFreshnessChip';
import { WhyAskButton } from './WhyAskButton';
import { countAttentionFlags, staleLabel } from './health';

interface ServiceCardHealthStripProps {
  serviceId: ServiceId;
  projectMeta?: ProjectOverview | null;
  overviewScanning: boolean;
  scanFreshness?: number;
  scanDuration?: number | null;
  scanDelta?: { outdated?: number | null; vulnerabilities?: number | null } | null;
  isRescanning: boolean;
  onRescan: () => void;
  onOpenDetail?: (serviceId: string, tab: DetailTab) => void;
  onOpenOverlay?: (serviceId: string, kind: 'notes' | 'license') => void;
}

export function ServiceCardHealthStrip({
  serviceId,
  projectMeta,
  overviewScanning,
  scanFreshness,
  scanDuration,
  scanDelta,
  isRescanning,
  onRescan,
  onOpenDetail,
  onOpenOverlay,
}: ServiceCardHealthStripProps) {
  const flagCount = countAttentionFlags(projectMeta);
  const hasOutdatedChip = (projectMeta?.outdated?.total ?? 0) > 0;
  const hasAuditChip =
    (projectMeta?.audit
      ? projectMeta.audit.critical +
        projectMeta.audit.high +
        projectMeta.audit.medium +
        projectMeta.audit.low
      : 0) > 0;
  const hasLicenseChip = licenseContaminationCount(projectMeta?.license) > 0;
  const hasSignals =
    !!projectMeta?.is_stale ||
    hasOutdatedChip ||
    hasAuditChip ||
    hasLicenseChip ||
    (!!projectMeta && flagCount > 0);
  const isScanning = overviewScanning && !!projectMeta?.runtime;
  const showFreshness = scanFreshness != null && !!projectMeta?.runtime;
  const isRuntimeProject = !!projectMeta?.runtime;

  return (
    <div
      className="border-border/40 -mx-1 -mt-1 flex min-h-[28px] flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-1 pb-2"
      onClick={(e) => e.stopPropagation()}
    >
      {hasSignals ? (
        <>
          {projectMeta?.is_stale && (
            <span
              className="bg-fg-dim/10 text-fg-dim rounded-app-sm inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              title={
                projectMeta.last_activity
                  ? `No activity since ${new Date(projectMeta.last_activity).toLocaleDateString()}`
                  : 'No activity recorded'
              }
            >
              <Clock className="h-3 w-3" />
              {staleLabel(projectMeta.last_activity)}
            </span>
          )}
          {hasOutdatedChip && projectMeta?.outdated && onOpenDetail && (
            <span className="inline-flex items-center">
              <OutdatedChip
                outdated={projectMeta.outdated}
                onClick={() => onOpenDetail(serviceId, 'outdated')}
              />
              {scanDelta?.outdated != null && scanDelta.outdated !== 0 && (
                <ScanDeltaBadge delta={scanDelta.outdated} severity="outdated" />
              )}
            </span>
          )}
          {hasAuditChip && projectMeta?.audit && onOpenDetail && (
            <span className="inline-flex items-center">
              <AuditChip
                audit={projectMeta.audit}
                onClick={() => onOpenDetail(serviceId, 'advisories')}
              />
              {scanDelta?.vulnerabilities != null && scanDelta.vulnerabilities !== 0 && (
                <ScanDeltaBadge delta={scanDelta.vulnerabilities} severity="risk" />
              )}
            </span>
          )}
          {hasLicenseChip && projectMeta?.license && (
            <LicenseChip
              license={projectMeta.license}
              onClick={() => onOpenOverlay?.(serviceId, 'license')}
            />
          )}
          {projectMeta && flagCount > 0 && (
            <WhyAskButton projectMeta={projectMeta} flagCount={flagCount} />
          )}
        </>
      ) : isRuntimeProject && showFreshness ? (
        <span
          className="text-tone-success-fg/80 inline-flex items-center gap-1 text-[10px] font-semibold tracking-tight"
          title="No outdated packages, no advisories, no stale activity"
        >
          <CheckCircle2 className="h-3 w-3" />
          All clear
        </span>
      ) : isRuntimeProject ? (
        <span
          className="text-fg-dim/80 inline-flex items-center gap-1 text-[10px] font-medium"
          title="No dependency scan recorded yet — run “Rescan deps” to surface CVEs and outdated packages"
        >
          <span aria-hidden className="bg-fg-dim/40 inline-block h-1 w-1 rounded-full" />
          Not yet scanned
        </span>
      ) : (
        <span
          className="text-fg-dim/50 inline-flex items-center gap-1 text-[10px] font-medium"
          title="This project has no language runtime detected — dependency scans don't apply"
        >
          <span aria-hidden>—</span>
          <span>No dependency tracking</span>
        </span>
      )}

      {(isScanning || showFreshness) && (
        <div className="text-fg-dim ml-auto flex items-center gap-1">
          {isScanning && (
            <span
              className="inline-flex h-5 items-center px-1"
              title="Dependency scan in progress for this project"
              aria-label="Scanning dependencies"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          )}
          {showFreshness && (
            <ScanFreshnessChip
              scannedAtMs={scanFreshness}
              durationMs={scanDuration ?? null}
              rescanning={isRescanning}
              onRescan={projectMeta?.runtime ? onRescan : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
