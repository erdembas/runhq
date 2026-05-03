import { Eye, EyeOff, FolderOpen, Globe, Pencil, Trash2 } from 'lucide-react';
import {
  AuditChip,
  LicenseChip,
  OutdatedChip,
  licenseContaminationCount,
} from '@/components/dashboard/healthChips';
import { EditorDropdown } from '@/components/EditorDropdown';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, StatusPill } from '@/components/ui/StatusDot';
import { TagChip } from '@/components/ui/TagChip';
import { cn } from '@/lib/cn';
import { localUrl } from '@/lib/url';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import type { ProjectOverview, ServiceDef, Status } from '@/types';

interface LogPanelTitleBarProps {
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
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot status={currentStatus} size="md" />
        <h2 className="text-fg text-[15px] font-semibold tracking-tight">{service.name}</h2>
        <StatusPill status={currentStatus} />
        <div className="ml-1 flex items-center gap-1.5">
          {service.tags.slice(0, 3).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </div>
        {projectMeta && (
          <div className="ml-1 flex items-center gap-1.5">
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
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          label={service.hide_dashboard ? 'Show on dashboard' : 'Hide from dashboard'}
          icon={service.hide_dashboard ? <EyeOff /> : <Eye />}
          size="sm"
          className={cn(service.hide_dashboard && 'text-accent hover:!text-accent')}
          onClick={onHideToggle}
        />
        <IconButton label="Edit" icon={<Pencil />} size="sm" onClick={onEdit} />
        <IconButton label="Delete" icon={<Trash2 />} size="sm" tone="danger" onClick={onDelete} />
        <IconButton label="Open folder" icon={<FolderOpen />} size="sm" onClick={onOpenFolder} />
        {service.port != null && (
          <IconButton
            label={`Open ${localUrl(service.port)}`}
            icon={<Globe />}
            size="sm"
            tone="accent"
            onClick={() => onOpenPort(service.port!)}
          />
        )}
        <EditorDropdown cwd={service.cwd} cmds={service.cmds} size="sm" />
      </div>
    </div>
  );
}
