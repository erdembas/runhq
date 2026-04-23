import { Flame, ArrowUpRight, Cpu, MemoryStick } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes, formatPercent } from '@/lib/format';
import { cpuToneClass, memoryToneClass } from '@/lib/resourceTone';
import type { ResourceSample, ServiceDef } from '@/types';

/**
 * Resource heatmap — answers ROADMAP §1's "which 3 projects are burning
 * 4GB combined?" without the user having to hunt through card-level
 * `ResourceBadge`s.
 *
 * Design choices:
 *   • Memory is the primary sort axis. CPU burst + returns to baseline;
 *     memory tends to be sticky and more predictive of "this process is
 *     leaking / misconfigured". Users who care more about CPU still see
 *     the CPU% per row, we just don't sort by it.
 *   • Relative bar (width = this-process / top-process) instead of
 *     absolute (width = this-process / machine-total). The user has
 *     20 projects, they want to know *which* is hot relative to its
 *     peers, not how much of their 64GB is still free.
 *   • Only running projects make the list. An idle service with a
 *     ghost sample from 20 minutes ago would pollute the ranking.
 *   • Renders nothing when there are no running samples — a portfolio
 *     at rest shouldn't eat a whole section of dashboard space
 *     announcing zero-usage.
 */
interface HeatmapEntry {
  service: ServiceDef;
  cpu: number;
  mem: number;
}

export function ResourceHeatmap({
  services,
  resources,
  runningIds,
  onJump,
  limit = 5,
}: {
  services: ServiceDef[];
  resources: Record<string, ResourceSample>;
  /**
   * Set of service ids with status === "running" (or "starting"). We
   * filter on this rather than "has a resource sample" because crashed
   * services retain their last sample for ~60s before GC.
   */
  runningIds: Set<string>;
  onJump: (serviceId: string) => void;
  limit?: number;
}) {
  const entries: HeatmapEntry[] = [];
  let totalMem = 0;
  let totalCpu = 0;
  for (const svc of services) {
    if (!runningIds.has(svc.id)) continue;
    const sample = resources[svc.id];
    if (!sample) continue;
    entries.push({ service: svc, cpu: sample.cpu_percent, mem: sample.memory_bytes });
    totalMem += sample.memory_bytes;
    totalCpu += sample.cpu_percent;
  }
  if (entries.length === 0) return null;

  entries.sort((a, b) => b.mem - a.mem);
  const shown = entries.slice(0, limit);
  const maxMem = shown[0]?.mem ?? 1;
  const hiddenCount = entries.length - shown.length;

  return (
    <section
      className="rounded-app border-border overflow-hidden border"
      aria-label="Resource usage heatmap"
    >
      <header className="border-border/60 flex items-center gap-2 border-b px-4 py-2">
        <Flame className="text-fg-dim h-3.5 w-3.5" />
        <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
          Running hot
        </span>
        <span className="text-fg-dim text-[11px] tabular-nums">{entries.length} running</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] tabular-nums">
          <span className="text-fg-dim inline-flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            <span className="text-fg/80">{formatPercent(totalCpu)}</span>
          </span>
          <span className="text-fg-dim inline-flex items-center gap-1">
            <MemoryStick className="h-3 w-3" />
            <span className="text-fg/80">{formatBytes(totalMem)}</span>
          </span>
        </div>
      </header>
      <ul className="divide-border/60 divide-y">
        {shown.map((entry) => (
          <HeatmapRow key={entry.service.id} entry={entry} maxMem={maxMem} onJump={onJump} />
        ))}
        {hiddenCount > 0 && (
          <li className="text-fg-dim px-4 py-1.5 text-[11px]">
            +{hiddenCount} more running below top {limit}
          </li>
        )}
      </ul>
    </section>
  );
}

function HeatmapRow({
  entry,
  maxMem,
  onJump,
}: {
  entry: HeatmapEntry;
  maxMem: number;
  onJump: (serviceId: string) => void;
}) {
  const { service: svc, cpu, mem } = entry;
  // Relative bar width (min 4% so even the smallest process shows a
  // visible sliver rather than a dot).
  const pct = Math.max(4, Math.round((mem / Math.max(maxMem, 1)) * 100));
  const cpuTone = cpuToneClass(cpu);
  const memTone = memoryToneClass(mem);
  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(svc.id)}
        className="group/row hover:bg-surface-muted/50 flex w-full items-center gap-3 px-4 py-2 text-left transition"
      >
        <span className="text-fg w-40 shrink-0 truncate text-[12px] font-semibold">{svc.name}</span>
        {/* Relative memory bar — width reflects mem / top-mem. */}
        <div
          className="bg-surface-muted relative h-1.5 flex-1 overflow-hidden rounded-full"
          aria-hidden
        >
          <div
            className="from-accent/60 to-accent h-full rounded-full bg-gradient-to-r transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn('w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums', memTone)}
        >
          {formatBytes(mem)}
        </span>
        <span
          className={cn('w-12 shrink-0 text-right font-mono text-[10.5px] tabular-nums', cpuTone)}
        >
          {formatPercent(cpu)}
        </span>
        <ArrowUpRight className="text-fg-dim group-hover/row:text-accent h-3.5 w-3.5 shrink-0 transition" />
      </button>
    </li>
  );
}
