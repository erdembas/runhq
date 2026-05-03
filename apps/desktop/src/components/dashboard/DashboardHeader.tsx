import { Cpu, Loader2, MemoryStick, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatBytes, formatPercent } from '@/lib/format';
import { DashboardActionsMenu } from './DashboardActionsMenu';
import type { DashboardModel } from './useDashboardModel';
import { deriveHeroState, scanFreshnessLabel, TONE_CLASSES } from './model';

interface Props {
  model: DashboardModel;
}

export function DashboardHeader({ model }: Props) {
  const heroState = deriveHeroState(model.stats, model.attentionStats);
  const heroTone = TONE_CLASSES[heroState.tone];

  return (
    <header className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-start @3xl/main:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-fg-dim mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('h-2 w-2 rounded-full', heroTone.dot)} />
            <span className="text-fg-muted font-semibold tracking-[0.14em] uppercase">
              Workspace
            </span>
          </span>
          <span className="text-fg-dim/40">·</span>
          <span>
            <span className="tabular-nums">{model.total}</span> service
            {model.total === 1 ? '' : 's'}
          </span>
          {model.appVersion && (
            <>
              <span className="text-fg-dim/40">·</span>
              <span className="text-fg-dim/80">v{model.appVersion}</span>
            </>
          )}
          <ScanStatus model={model} />
        </div>
        <h1 className="text-fg text-[32px] leading-[1.1] font-semibold tracking-tight">
          {heroState.count != null ? (
            <>
              <span className={cn('tabular-nums', heroTone.count)}>{heroState.count}</span>
              <span className="text-fg"> {heroState.label}</span>
            </>
          ) : (
            <span className={cn(heroTone.count)}>{heroState.label}</span>
          )}
        </h1>
        <HeaderSubline model={model} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          ref={model.workspaceReport.triggerRef}
          variant="secondary"
          size="sm"
          leftIcon={<Sparkles className="h-3.5 w-3.5" />}
          onClick={() => {
            if (model.services.length === 0) return;
            model.workspaceReport.onClick();
          }}
          disabled={model.services.length === 0}
          title="AI report across all projects"
        >
          Analyze Workspace
        </Button>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => model.openEditor(null)}
        >
          New service
        </Button>
        <DashboardActionsMenu
          onDiscover={model.onScan}
          onNewStack={() => model.openStackEditor(null)}
          onRescan={() => void model.runScan()}
          disableRescan={model.overviewScanning || !model.overview}
          rescanLabel={
            model.overviewScanning
              ? 'Scanning…'
              : model.overview?.has_dependency_scan
                ? 'Rescan deps'
                : 'Scan deps'
          }
        />
        {model.workspaceReport.popover}
      </div>
    </header>
  );
}

export function DashboardBackdrop({ model }: Props) {
  const heroTone = TONE_CLASSES[deriveHeroState(model.stats, model.attentionStats).tone];
  if (!heroTone.backdrop) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
      style={{
        background: `radial-gradient(900px 340px at 50% -20%, ${heroTone.backdrop}, transparent 70%)`,
      }}
    />
  );
}

function ScanStatus({ model }: Props) {
  if (model.lastScanAt != null && !model.overviewScanning) {
    return (
      <>
        <span className="text-fg-dim/40">·</span>
        <span title={`Dependency scan completed ${new Date(model.lastScanAt).toLocaleString()}`}>
          {scanFreshnessLabel(model.lastScanAt, model.now).replace('Scanned ', 'Last scan ')}
        </span>
        <button
          type="button"
          onClick={() => void model.runScan()}
          disabled={model.overviewScanning}
          className="text-fg-dim hover:text-accent inline-flex items-center gap-1 transition disabled:opacity-50"
          title="Re-run npm outdated / cargo audit / license scan across all projects"
        >
          <RefreshCw className="h-3 w-3" />
          Rescan
        </button>
      </>
    );
  }
  if (model.overviewScanning) {
    return (
      <>
        <span className="text-fg-dim/40">·</span>
        <span className="text-fg-muted inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Scanning…
        </span>
      </>
    );
  }
  return (
    <>
      {model.lastScanAt == null && model.overview && !model.overview.has_dependency_scan && (
        <>
          <span className="text-fg-dim/40">·</span>
          <button
            type="button"
            onClick={() => void model.runScan()}
            className="text-fg-dim hover:text-accent inline-flex items-center gap-1 transition"
            title="Run npm outdated / cargo audit / license scan across all projects"
          >
            <Sparkles className="h-3 w-3" />
            Run first scan
          </button>
        </>
      )}
      {model.staleScanServiceIds.length > 0 && (
        <>
          <span className="text-fg-dim/40">·</span>
          <button
            type="button"
            onClick={() => void model.runStaleRescan()}
            className="border-tone-warning/30 bg-tone-warning-bg/25 text-tone-warning-fg hover:bg-tone-warning-bg/45 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition"
            title={`${model.staleScanServiceIds.length} project${
              model.staleScanServiceIds.length === 1 ? '' : 's'
            } not scanned in 7+ days — click to rescan only the stale ones`}
          >
            <span className="bg-tone-warning/70 inline-block h-1.5 w-1.5 rounded-full" />
            {model.staleScanServiceIds.length} stale
          </button>
        </>
      )}
    </>
  );
}

function HeaderSubline({ model }: Props) {
  if (model.stats.running === 0 && model.stats.starting === 0 && model.ports.length === 0) {
    return null;
  }
  return (
    <p className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      {model.stats.running > 0 && model.totals.mem > 0 && (
        <>
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            title={`Aggregate memory across ${model.stats.running} running project${
              model.stats.running > 1 ? 's' : ''
            }`}
          >
            <MemoryStick className="text-fg-dim h-3 w-3" />
            {formatBytes(model.totals.mem)}
          </span>
          <span className="text-fg-dim/50">·</span>
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            title={`Aggregate CPU across ${model.stats.running} running project${
              model.stats.running > 1 ? 's' : ''
            }`}
          >
            <Cpu className="text-fg-dim h-3 w-3" />
            {formatPercent(model.totals.cpu)}
          </span>
          {(model.stats.starting > 0 || model.ports.length > 0) && (
            <span className="text-fg-dim/50">·</span>
          )}
        </>
      )}
      {model.stats.starting > 0 && (
        <>
          <span className="text-status-starting inline-flex items-center gap-1 tabular-nums">
            <Loader2 className="h-3 w-3 animate-spin" />
            {model.stats.starting} starting
          </span>
          {model.ports.length > 0 && <span className="text-fg-dim/50">·</span>}
        </>
      )}
      {model.ports.length > 0 && (
        <span
          className="tabular-nums"
          title={`${model.ports.length} listening port${model.ports.length === 1 ? '' : 's'}`}
        >
          {model.ports.length} port{model.ports.length === 1 ? '' : 's'}
        </span>
      )}
    </p>
  );
}
