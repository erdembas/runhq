import * as i18n from '@runhq/cockpit-ui/i18n';
import { lazy, Suspense, useState } from 'react';
import { Bot, FolderGit2 } from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';
import { modChord } from '@/lib/platform';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import { DashboardSkeleton } from './DashboardSkeleton';
import { FreshWorkspaceEmpty, HiddenProjectsEmpty } from './DashboardEmptyStates';
import { DashboardBackdrop, DashboardHeader } from './DashboardHeader';
import { DashboardFilters } from './DashboardFilters';
import { DashboardOverlays } from './DashboardOverlays';
import { DashboardServiceSections } from './DashboardServiceSections';
import { ResourceHeatmap } from './ResourceHeatmap';
import { WorstOffenders } from './WorstOffenders';
import { useDashboardModel } from './useDashboardModel';

const AgentDashboard = lazy(() =>
  import('./AgentDashboard').then((module) => ({ default: module.AgentDashboard })),
);

interface Props {
  onScan: () => void;
  visible?: boolean;
}

export function Dashboard({ onScan, visible = true }: Props) {
  i18n.useLocale();
  const [agents, setAgents] = usePersistentBoolean('runhq.dashboard-agents', false);
  const [agentsVisited, setAgentsVisited] = useState(agents);

  return (
    <div className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border/60 shrink-0 border-b">
        <div className="mx-auto flex w-full max-w-6xl px-4 py-3 sm:px-8">
          <div
            role="group"
            aria-label={i18n.t('Dashboard view')}
            className="bg-fg/4 inline-flex gap-1 rounded-xl p-1"
          >
            {[
              { value: false, label: i18n.t('Project dashboard'), icon: FolderGit2 },
              { value: true, label: i18n.t('Agent dashboard'), icon: Bot },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                aria-pressed={agents === value}
                onClick={() => {
                  if (value) setAgentsVisited(true);
                  setAgents(value);
                }}
                className={`focus-visible:ring-accent/40 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors outline-none focus-visible:ring-2 ${agents === value ? 'bg-surface-raised text-fg font-medium shadow-sm' : 'text-fg-dim hover:text-fg hover:bg-fg/3'}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`${agents ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1`}>
        <ProjectDashboard onScan={onScan} visible={visible && !agents} />
      </div>
      {agentsVisited && (
        <div className={`${agents ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1`}>
          <Suspense fallback={<DashboardSkeleton />}>
            <AgentDashboard visible={visible && agents} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function ProjectDashboard({ onScan, visible = true }: Props) {
  i18n.useLocale();
  const model = useDashboardModel(onScan, visible);

  if (!model.servicesLoaded) return <DashboardSkeleton />;

  if (model.allServices.length === 0) {
    return <FreshWorkspaceEmpty onScan={onScan} onAddService={model.openEditor} />;
  }

  if (model.total === 0) {
    return (
      <HiddenProjectsEmpty
        hiddenCount={model.hiddenCount}
        onAddService={model.openEditor}
        onShowHidden={() => model.setShowHidden(true)}
      />
    );
  }

  return (
    <div className="bg-surface relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex-1 overflow-y-auto">
          <DashboardBackdrop model={model} />
          <div className="@container/main relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
            <DashboardHeader model={model} />
            {model.overview && model.overview.projects.length > 0 && (
              <WorstOffenders
                projects={model.overview.projects}
                onOpenDetail={model.openDetail}
                limit={5}
              />
            )}
            {model.stats.running > 0 && (
              <ResourceHeatmap
                services={model.services}
                resources={model.resources}
                runningIds={model.runningServiceIds}
                onJump={model.selectService}
                limit={5}
              />
            )}
            <DashboardFilters model={model} />
            <DashboardServiceSections model={model} />
            <DashboardFooter />
          </div>
        </div>
      </div>
      <DashboardOverlays model={model} />
    </div>
  );
}

function DashboardFooter() {
  i18n.useLocale();
  return (
    <footer className="text-fg-dim mt-auto flex items-center justify-between pt-4 text-[11px]">
      <span>{i18n.t('Everything runs locally. No telemetry.')}</span>
      <span className="flex items-center gap-1.5 opacity-70">
        <Kbd>{modChord('K')}</Kbd>
        <span>{i18n.t('quick jump')}</span>
      </span>
    </footer>
  );
}
