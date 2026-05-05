'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Network as NetworkIcon,
  Search as SearchIcon,
  SlidersHorizontal,
} from 'lucide-react';
import type { ResourceSample, ServiceDef, ServiceId, Status } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';
import { DashboardHeader } from './DashboardHeader';
import { DashboardServiceCard } from './DashboardServiceCard';
import { MainTabBar, type MainTab } from './MainTabBar';
import { RightActivityRail } from './RightActivityRail';
import { RunningHotPanel, type RunningHotRow } from './RunningHotPanel';
import { type RuntimeBadgeKey } from './RuntimeBadge';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { WorkspaceSidebar, type SidebarSection } from './WorkspaceSidebar';

export interface DesktopDashboardSection {
  id: string | null;
  name: string;
  color?: SidebarSection['color'];
  /** Service ids in render order. */
  serviceIds: ServiceId[];
}

interface Props {
  services: ServiceDef[];
  sections: DesktopDashboardSection[];
  /** Initial status map. The composite copies this into local state so
   *  visitors can actually toggle Stop/Start in the marketing demo and
   *  watch totals + the running-hot panel re-derive in real time. */
  statuses: Record<ServiceId, Status>;
  samples?: Record<ServiceId, ResourceSample | undefined>;
  runtimes?: Record<ServiceId, RuntimeBadgeKey>;
  /** Per-service branch for the card's branch chip. */
  branches?: Record<ServiceId, string>;
  /** Per-service "last scan" relative string. */
  lastScans?: Record<ServiceId, string>;
  /** Per-service log tail (3 lines) shown inside the card preview. */
  logTails?: Record<ServiceId, string[]>;
  /** Marketing copy override for the headline number. Defaults to
   *  the count of services in `error` status. */
  attentionCount?: number;
  /** App version surfaced in the status bar release pill. */
  version?: string;
  className?: string;
  releaseNotesHref?: string;
}

/**
 * Full-fidelity desktop dashboard mockup composed entirely of
 * cockpit-ui primitives. This is the marketing surface's "look at
 * the actual product" hero section — drop it on any page with the
 * fixtures from `apps/site/src/lib/fixtures/dashboard.ts` and you
 * get a pixel-close re-creation of what the user sees after `runhq`
 * launches.
 *
 * Heavy reliance on `useMemo` here is intentional: the running-hot
 * panel + workspace totals derive from `services × statuses ×
 * samples`, which can run on every parent re-render but the inputs
 * are stable across selection state changes (only `selectedTabId`
 * changes per click). Memoising avoids reshuffling the bar list
 * order while the user is scanning it.
 */
export function DesktopDashboard({
  services,
  sections,
  statuses: initialStatuses,
  samples,
  runtimes,
  branches,
  lastScans,
  logTails,
  attentionCount,
  version = 'v1.0.0',
  releaseNotesHref,
  className,
}: Props) {
  const [activeTabId, setActiveTabId] = useState<string>('dashboard');
  const [selectedServiceId, setSelectedServiceId] = useState<ServiceId | null>(null);

  // Local mutable status map. Initial values come from props; visitor
  // clicks on Stop/Start/Restart flip entries in here so the rest of
  // the composite (totals, running-hot, tab bar) can derive a coherent
  // new state. Keeping it local means the marketing fixture stays a
  // pure read-only object the section can hand back in unchanged.
  const [statuses, setStatuses] = useState<Record<ServiceId, Status>>(initialStatuses);

  // Restart timers keyed by service id. We need to clear pending
  // transitions if the user clicks Stop while a Start animation is
  // still in flight, otherwise the state machine could land on
  // "running" two seconds after the visitor explicitly stopped it.
  const restartTimers = useRef<Record<ServiceId, ReturnType<typeof setTimeout> | undefined>>({});

  const setStatus = useCallback((id: ServiceId, next: Status) => {
    setStatuses((prev) => ({ ...prev, [id]: next }));
  }, []);

  const clearTimer = useCallback((id: ServiceId) => {
    const t = restartTimers.current[id];
    if (t) {
      clearTimeout(t);
      restartTimers.current[id] = undefined;
    }
  }, []);

  const handleToggle = useCallback(
    (id: ServiceId) => {
      clearTimer(id);
      const current = statuses[id] ?? 'stopped';
      if (current === 'running') {
        setStatus(id, 'stopping');
        restartTimers.current[id] = setTimeout(() => setStatus(id, 'stopped'), 350);
      } else if (current === 'stopped' || current === 'exited' || current === 'crashed') {
        setStatus(id, 'starting');
        restartTimers.current[id] = setTimeout(() => setStatus(id, 'running'), 700);
      }
    },
    [statuses, setStatus, clearTimer],
  );

  const handleRestart = useCallback(
    (id: ServiceId) => {
      clearTimer(id);
      setStatus(id, 'stopping');
      restartTimers.current[id] = setTimeout(() => {
        setStatus(id, 'starting');
        restartTimers.current[id] = setTimeout(() => setStatus(id, 'running'), 600);
      }, 300);
    },
    [setStatus, clearTimer],
  );

  const serviceMap = useMemo(
    () => Object.fromEntries(services.map((s) => [s.id, s])) as Record<ServiceId, ServiceDef>,
    [services],
  );

  // ---------- Derived metrics ----------

  const totals = useMemo(() => {
    let memory = 0;
    let cpu = 0;
    let running = 0;
    let idle = 0;
    let needsAttention = 0;
    for (const svc of services) {
      const s = statuses[svc.id] ?? 'stopped';
      if (s === 'running') {
        running += 1;
        const sample = samples?.[svc.id];
        if (sample) {
          memory += sample.memory_bytes;
          cpu += sample.cpu_percent;
        }
      } else if (s === 'stopped' || s === 'exited') {
        idle += 1;
      } else if (s === 'crashed') {
        needsAttention += 1;
      }
    }
    return { memory, cpu, running, idle, needsAttention };
  }, [services, statuses, samples]);

  const ports = useMemo(
    () => services.reduce((acc, svc) => acc + (svc.port ? 1 : 0), 0),
    [services],
  );

  const runningRows: RunningHotRow[] = useMemo(() => {
    const rows: RunningHotRow[] = [];
    let max = 0;
    for (const svc of services) {
      if ((statuses[svc.id] ?? 'stopped') !== 'running') continue;
      const sample = samples?.[svc.id];
      if (!sample) continue;
      max = Math.max(max, sample.memory_bytes);
      rows.push({
        name: svc.name,
        memoryBytes: sample.memory_bytes,
        cpuPercent: sample.cpu_percent,
        fill: 0,
      });
    }
    return rows
      .map((r) => ({ ...r, fill: max > 0 ? r.memoryBytes / max : 0 }))
      .sort((a, b) => b.memoryBytes - a.memoryBytes);
  }, [services, statuses, samples]);

  const tabs: MainTab[] = useMemo(() => {
    const runningSvcs = services.filter((s) => statuses[s.id] === 'running');
    return [
      { id: 'dashboard', kind: 'dashboard', label: 'Dashboard' },
      ...runningSvcs.map<MainTab>((s) => ({
        id: s.id,
        kind: 'service',
        label: s.name,
        serviceId: s.id,
      })),
    ];
  }, [services, statuses]);

  // ---------- Sidebar normalisation ----------

  // Flatten the caller's sections + synthesize an "Unassigned" bucket
  // for any service not claimed by an explicit section. The sidebar
  // expects a stable id, so the synthesized id is `null`.
  const sidebarSections: SidebarSection[] = useMemo(() => {
    const claimed = new Set<ServiceId>();
    for (const sec of sections) {
      for (const id of sec.serviceIds) claimed.add(id);
    }
    const unassigned = services.filter((s) => !claimed.has(s.id)).map((s) => s.id);
    const all: SidebarSection[] = sections.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      serviceIds: s.serviceIds,
    }));
    if (unassigned.length > 0) {
      all.push({
        id: null,
        name: 'Unassigned',
        color: 'slate',
        serviceIds: unassigned,
      });
    }
    return all;
  }, [services, sections]);

  // ---------- Render ----------

  return (
    <div
      className={cn(
        'border-border bg-surface text-fg flex flex-col overflow-hidden rounded-xl border shadow-2xl',
        className,
      )}
      // `height` (not min-height) gives the flex-col children a definite
      // sizing context so the body row's `flex-1` actually grows. With
      // min-height alone the chain is indefinite and the sidebar's
      // bottom-pinned footer ends up floating after the last item with
      // empty space below — the user noticed this immediately.
      style={{ height: 760 }}
    >
      <TitleBar
        title="RunHQ"
        rightSlot={
          <span className="bg-status-running/15 text-status-running flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold">
            <span className="bg-status-running h-1.5 w-1.5 rounded-full" />
            {totals.running} running
          </span>
        }
      />

      <MainTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        statuses={statuses}
        onSelect={setActiveTabId}
      />

      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          services={services}
          sections={sidebarSections}
          statuses={statuses}
          samples={samples}
          runtimes={runtimes}
          selectedServiceId={selectedServiceId}
          onSelectService={(id) => {
            setSelectedServiceId(id);
            // Mirror the desktop's behaviour: clicking a sidebar item
            // jumps to that service's tab when one exists. If the
            // service isn't running there's no tab yet — fall back to
            // the dashboard so the user lands somewhere sensible.
            setActiveTabId(statuses[id] === 'running' ? id : 'dashboard');
          }}
          workspaceTotals={{
            total: services.length,
            running: totals.running,
            dirty: 3,
          }}
          className="w-[260px]"
        />

        <main className="bg-surface-muted/30 scrollbar-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <DashboardHeader
            serviceCount={services.length}
            version={version}
            lastScan="1h ago"
            attentionCount={attentionCount ?? Math.max(1, totals.needsAttention)}
            totals={{
              memoryBytes: totals.memory,
              cpuPercent: totals.cpu,
              ports,
            }}
          />

          {runningRows.length > 0 && (
            <RunningHotPanel
              rows={runningRows}
              totalMemoryBytes={totals.memory}
              totalCpuPercent={totals.cpu}
              className="mb-3"
            />
          )}

          {/* Search + filter strip — visual only, no live filtering. */}
          <div className="flex flex-wrap items-center gap-2 px-6 pb-3 text-[11.5px]">
            <div className="border-border bg-surface text-fg-dim flex h-7 max-w-xs flex-1 items-center gap-2 rounded-md border px-2.5">
              <SearchIcon className="h-3 w-3" />
              <span>Search projects</span>
              <span className="border-border bg-surface-muted text-fg-dim ml-auto rounded border px-1.5 font-mono text-[10px]">
                /
              </span>
            </div>
            <div className="text-fg-muted ml-auto flex items-center gap-1.5">
              {(['Attention', 'Git', 'Section', 'Name'] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  className="border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg flex h-7 items-center gap-1 rounded-md border px-2 transition"
                >
                  {label === 'Section' || label === 'Name' ? (
                    <SlidersHorizontal className="text-fg-dim h-3 w-3" />
                  ) : label === 'Git' ? (
                    <NetworkIcon className="text-fg-dim h-3 w-3" />
                  ) : null}
                  <span className="text-[10.5px] font-semibold tracking-[0.04em] uppercase">
                    {label}
                  </span>
                  <span className="text-fg">
                    {label === 'Attention' ? `All (${services.length})` : 'All'}
                  </span>
                  <ChevronDown className="text-fg-dim h-3 w-3" />
                </button>
              ))}
            </div>
          </div>

          {/* Card grid — one block per section. */}
          <div className="flex flex-col gap-5 px-6 pb-6">
            {sidebarSections.map((section) => {
              const sectionServices = section.serviceIds
                .map((id) => serviceMap[id])
                .filter(Boolean) as ServiceDef[];
              if (sectionServices.length === 0) return null;
              const sectionRunning = sectionServices.filter(
                (s) => (statuses[s.id] ?? 'stopped') === 'running',
              ).length;
              return (
                <section key={section.id ?? '__unassigned'} className="flex flex-col gap-2.5">
                  <header className="text-fg-muted flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        'inline-block h-1.5 w-1.5 rounded-full',
                        section.color === 'orange'
                          ? 'bg-accent'
                          : section.color === 'yellow'
                            ? 'bg-status-starting'
                            : 'bg-fg-dim',
                      )}
                    />
                    <span className="font-semibold tracking-[0.06em] uppercase">
                      {section.name}
                    </span>
                    <span className="text-fg-dim font-mono text-[10.5px] tracking-normal normal-case">
                      {sectionServices.length}
                    </span>
                    {sectionRunning > 0 && (
                      <span className="bg-status-running/12 text-status-running rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-normal normal-case">
                        ● {sectionRunning} on
                      </span>
                    )}
                  </header>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {sectionServices.map((svc) => (
                      <DashboardServiceCard
                        key={svc.id}
                        service={svc}
                        status={statuses[svc.id] ?? 'stopped'}
                        runtime={runtimes?.[svc.id]}
                        sample={samples?.[svc.id]}
                        branch={branches?.[svc.id]}
                        lastScan={lastScans?.[svc.id]}
                        logTail={logTails?.[svc.id]}
                        attention={
                          svc.id === 'svc-acme-web' ? { count: 5, tone: 'warning' } : undefined
                        }
                        selected={selectedServiceId === svc.id}
                        onSelect={() => {
                          setSelectedServiceId(svc.id);
                          if (statuses[svc.id] === 'running') {
                            setActiveTabId(svc.id);
                          }
                        }}
                        onToggleStatus={() => handleToggle(svc.id)}
                        onRestart={() => handleRestart(svc.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </main>

        <RightActivityRail />
      </div>

      <StatusBar
        running={totals.running}
        idle={totals.idle}
        cpuPercent={totals.cpu}
        memoryBytes={totals.memory}
        ports={ports}
        version={version}
        releaseNotesHref={releaseNotesHref}
      />
    </div>
  );
}
