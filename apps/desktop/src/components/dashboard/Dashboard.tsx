import { Kbd } from '@/components/ui/Kbd';
import { modChord } from '@/lib/platform';
import { DashboardSkeleton } from './DashboardSkeleton';
import { FreshWorkspaceEmpty, HiddenProjectsEmpty } from './DashboardEmptyStates';
import { DashboardBackdrop, DashboardHeader } from './DashboardHeader';
import { DashboardFilters } from './DashboardFilters';
import { DashboardOverlays } from './DashboardOverlays';
import { DashboardServiceSections } from './DashboardServiceSections';
import { ResourceHeatmap } from './ResourceHeatmap';
import { WorstOffenders } from './WorstOffenders';
import { useDashboardModel } from './useDashboardModel';

interface Props {
  onScan: () => void;
}

export function Dashboard({ onScan }: Props) {
  const model = useDashboardModel(onScan);

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
  return (
    <footer className="text-fg-dim mt-auto flex items-center justify-between pt-4 text-[11px]">
      <span>Everything runs locally. No telemetry.</span>
      <span className="flex items-center gap-1.5 opacity-70">
        <Kbd>{modChord('K')}</Kbd>
        <span>quick jump</span>
      </span>
    </footer>
  );
}
