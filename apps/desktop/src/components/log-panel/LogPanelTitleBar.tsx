import * as i18n from '@runhq/cockpit-ui/i18n';
import type { ReactNode } from 'react';
import { Eye, EyeOff, FolderOpen, Globe, Pencil, Trash2 } from 'lucide-react';
import {
  AuditChip,
  LicenseChip,
  OutdatedChip,
  licenseContaminationCount,
} from '@/components/dashboard/healthChips';
import { EditorDropdown } from '@/components/EditorDropdown';
import { ProjectAgentButton } from '@/components/agents/AgentNavigation';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { TagChip } from '@/components/ui/TagChip';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import type { ProjectOverview, ServiceDef, Status } from '@/types';

interface LogPanelTitleBarProps {
  compact?: boolean;
  controls?: ReactNode;
  currentStatus: Status;
  onDelete: () => void;
  onEdit: () => void;
  onHideToggle: () => void;
  onLicenseOpen: () => void;
  onOpenDetail: (tab: DetailTab) => void;
  onOpenFolder: () => void;
  onOpenPort: (port: number) => void;
  projectMeta: ProjectOverview | null;
  service: ServiceDef;
}

export function LogPanelTitleBar({
  compact = false,
  controls,
  currentStatus,
  onDelete,
  onEdit,
  onHideToggle,
  onLicenseOpen,
  onOpenDetail,
  onOpenFolder,
  onOpenPort,
  projectMeta,
  service,
}: LogPanelTitleBarProps) {
  i18n.useLocale();
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2.5">
        <StatusDot status={currentStatus} size="sm" />
        <h2
          className="text-fg max-w-64 truncate text-[13px] font-semibold tracking-tight"
          title={service.name}
        >
          {service.name}
        </h2>
        {compact ? (
          <span className="text-fg-dim text-[11px] capitalize">{currentStatus}</span>
        ) : (
          <StatusPill status={currentStatus} />
        )}
        {!compact && (
          <div className="ml-1 flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
            {service.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        )}
        {!compact && projectMeta && (
          <div className="ml-1 flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
            {projectMeta.outdated && projectMeta.outdated.total > 0 && (
              <OutdatedChip
                outdated={projectMeta.outdated}
                onClick={() => onOpenDetail('outdated')}
              />
            )}
            {projectMeta.audit &&
              projectMeta.audit.critical +
                projectMeta.audit.high +
                projectMeta.audit.medium +
                projectMeta.audit.low >
                0 && (
                <AuditChip audit={projectMeta.audit} onClick={() => onOpenDetail('advisories')} />
              )}
            {projectMeta.license && licenseContaminationCount(projectMeta.license) > 0 && (
              <LicenseChip license={projectMeta.license} onClick={onLicenseOpen} />
            )}
          </div>
        )}
      </div>
      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
        {!compact && (
          <>
            <ProjectAgentButton serviceId={service.id} />
            <IconButton
              label={
                service.hide_dashboard ? i18n.t('Show on dashboard') : i18n.t('Hide from dashboard')
              }
              icon={service.hide_dashboard ? <EyeOff /> : <Eye />}
              size="sm"
              className={cn(service.hide_dashboard && 'text-accent hover:!text-accent')}
              onClick={onHideToggle}
            />
            <IconButton label={i18n.t('Edit')} icon={<Pencil />} size="sm" onClick={onEdit} />
            <IconButton
              label={i18n.t('Delete')}
              icon={<Trash2 />}
              size="sm"
              tone="danger"
              onClick={onDelete}
            />
            <IconButton
              label={i18n.t('Open folder')}
              icon={<FolderOpen />}
              size="sm"
              onClick={onOpenFolder}
            />
            {service.port != null && (
              <IconButton
                label={i18n.t('Open {value1}', { value1: localUrl(service.port) })}
                icon={<Globe />}
                size="sm"
                tone="accent"
                onClick={() => onOpenPort(service.port!)}
              />
            )}
            <EditorDropdown cwd={service.cwd} cmds={service.cmds} size="sm" />
          </>
        )}
        {controls}
      </div>
    </div>
  );
}
