import { Flame } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatBytes, formatPercent } from '../lib/format';

export interface RunningHotRow {
  name: string;
  memoryBytes: number;
  cpuPercent: number;
  /** 0-1 fill ratio for the bar. Caller supplies this so the panel
   *  doesn't make scaling decisions — typically `memoryBytes /
   *  maxBytes`. */
  fill: number;
}

interface Props {
  rows: RunningHotRow[];
  totalMemoryBytes: number;
  totalCpuPercent: number;
  className?: string;
}

/**
 * Compact "Running hot" leaderboard pinned above the dashboard's
 * service grid. Surfaces the heaviest currently-running services so
 * the user can triage at a glance.
 *
 * Pure presentation — caller computes the rows + totals.
 */
export function RunningHotPanel({ rows, totalMemoryBytes, totalCpuPercent, className }: Props) {
  return (
    <section
      className={cn(
        'border-border bg-surface mx-6 flex flex-col gap-2 rounded-lg border px-4 py-3',
        className,
      )}
    >
      <header className="flex items-center justify-between text-[11px]">
        <div className="text-fg-muted flex items-center gap-1.5 font-semibold tracking-[0.06em] uppercase">
          <Flame className="text-accent h-3 w-3" />
          Running hot
          <span className="text-fg-dim font-mono text-[10px] tracking-normal normal-case">
            {rows.length} running
          </span>
        </div>
        <div className="text-fg-muted flex items-center gap-3 font-mono tabular-nums">
          <span>{totalCpuPercent.toFixed(1)}%</span>
          <span>{Math.round(totalMemoryBytes / (1024 * 1024))} MB</span>
        </div>
      </header>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-3">
            <span className="text-fg w-28 shrink-0 truncate text-[12px] font-medium">
              {row.name}
            </span>
            <div className="bg-surface-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-accent h-full rounded-full"
                style={{ width: `${Math.max(2, Math.round(row.fill * 100))}%` }}
              />
            </div>
            <span className="text-fg-muted w-14 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
              {formatBytes(row.memoryBytes)}
            </span>
            <span className="text-fg-muted w-10 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
              {formatPercent(row.cpuPercent)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
