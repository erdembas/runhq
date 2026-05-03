import { CommandTabs } from './CommandTabs';
import { LogPanelTitleBar } from './LogPanelTitleBar';
import { LogPanelToolbar } from './LogPanelToolbar';
import type { DetailTab } from '@/components/ProjectDetailDrawer';
import type { CommandStatus, ListeningPort, ProjectOverview, ServiceDef, Status } from '@/types';

interface LogPanelHeaderProps {
  activeCmd: string | null;
  cmdStatuses: CommandStatus[];
  currentStatus: Status;
  filter: string;
  isServiceRunning: boolean;
  openPortsPopover: boolean;
  ports: ListeningPort[];
  projectMeta: ProjectOverview | null;
  service: ServiceDef;
  servicePid: number | null;
  onDelete: () => void;
  onEdit: () => void;
  onHideToggle: () => void;
  onLicenseOpen: () => void;
  onOpenDetail: (tab: DetailTab) => void;
  onOpenFolder: () => void;
  onOpenPopoverChange: (open: boolean) => void;
  onOpenPort: (port: number) => void;
  onRestart: () => void;
  onSelectCommand: (name: string | null) => void;
  onSetFilter: (filter: string) => void;
  onStart: () => void;
  onStop: () => void;
}

export function LogPanelHeader({
  activeCmd,
  cmdStatuses,
  currentStatus,
  filter,
  isServiceRunning,
  openPortsPopover,
  ports,
  projectMeta,
  service,
  servicePid,
  onDelete,
  onEdit,
  onHideToggle,
  onLicenseOpen,
  onOpenDetail,
  onOpenFolder,
  onOpenPopoverChange,
  onOpenPort,
  onRestart,
  onSelectCommand,
  onSetFilter,
  onStart,
  onStop,
}: LogPanelHeaderProps) {
  return (
    <div className="border-border/70 bg-surface-raised flex shrink-0 flex-col gap-2.5 border-b px-5 py-3">
      <LogPanelTitleBar
        currentStatus={currentStatus}
        projectMeta={projectMeta}
        service={service}
        onOpenDetail={onOpenDetail}
        onLicenseOpen={onLicenseOpen}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenFolder={onOpenFolder}
        onOpenPort={onOpenPort}
        onHideToggle={onHideToggle}
      />

      <LogPanelToolbar
        filter={filter}
        isServiceRunning={isServiceRunning}
        openPortsPopover={openPortsPopover}
        ports={ports}
        service={service}
        servicePid={servicePid}
        onOpenPopoverChange={onOpenPopoverChange}
        onSetFilter={onSetFilter}
        onStart={onStart}
        onRestart={onRestart}
        onStop={onStop}
      />

      <CommandTabs
        activeCmd={activeCmd}
        cmdStatuses={cmdStatuses}
        service={service}
        onSelect={onSelectCommand}
      />
    </div>
  );
}
