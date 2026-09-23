import * as i18n from '@runhq/cockpit-ui/i18n';
import { useId } from 'react';
import { ChevronDown, ChevronUp, Play, Square } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
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
  onSelectCommand: (name: string) => void;
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
  i18n.useLocale();
  const controlsId = useId();
  const [collapsed, setCollapsed] = usePersistentBoolean(
    `runhq.service-controls-collapsed.${service.id}`,
    true,
  );
  return (
    <div className="border-border/70 bg-surface-raised flex shrink-0 flex-col border-b px-4 py-2">
      <LogPanelTitleBar
        compact={collapsed}
        controls={
          <>
            {collapsed && (
              <>
                {filter && (
                  <button
                    type="button"
                    title={i18n.t('Log filter: {filter}', { filter: filter })}
                    className="text-fg-muted hover:text-fg rounded px-2 py-1 text-[11px]"
                    onClick={() => setCollapsed(false)}
                  >
                    {i18n.t('Logs filtered')}
                  </button>
                )}
                <IconButton
                  label={isServiceRunning ? i18n.t('Stop service') : i18n.t('Start service')}
                  icon={isServiceRunning ? <Square /> : <Play />}
                  size="sm"
                  onClick={isServiceRunning ? onStop : onStart}
                />
              </>
            )}
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-controls={controlsId}
              aria-label={
                collapsed ? i18n.t('Expand service controls') : i18n.t('Collapse service controls')
              }
              title={
                collapsed ? i18n.t('Expand service controls') : i18n.t('Collapse service controls')
              }
              className="text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-accent/40 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => {
                if (!collapsed) onOpenPopoverChange(false);
                setCollapsed(!collapsed);
              }}
            >
              <span>{i18n.t('Controls')}</span>
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        }
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

      <div id={controlsId} hidden={collapsed} className="pt-2">
        {!collapsed && (
          <LogPanelToolbar
            filter={filter}
            isServiceRunning={isServiceRunning}
            activeCmd={activeCmd}
            cmdStatuses={cmdStatuses}
            openPortsPopover={openPortsPopover}
            ports={ports}
            service={service}
            servicePid={servicePid}
            onOpenPopoverChange={onOpenPopoverChange}
            onSetFilter={onSetFilter}
            onStart={onStart}
            onRestart={onRestart}
            onStop={onStop}
            onSelectCommand={onSelectCommand}
          />
        )}
      </div>
    </div>
  );
}
