import { cn } from '@/lib/cn';
import type { DailySummary } from '@/types';
import type { TimelineSize } from './types';

interface ActivityWeeklySparklineProps {
  weeklySummary: DailySummary[] | null;
  size: TimelineSize;
}

export function ActivityWeeklySparkline({ weeklySummary, size }: ActivityWeeklySparklineProps) {
  if (!weeklySummary || weeklySummary.length === 0) return null;
  const maxTotal = Math.max(
    ...weeklySummary.map((summary) => summary.commits + summary.services_started + summary.errors),
    1,
  );
  const totalWeek = weeklySummary.reduce(
    (total, summary) => total + summary.commits + summary.services_started + summary.errors,
    0,
  );

  return (
    <div className={cn('border-border/40 border-t py-3', size.padX)}>
      <div className="text-fg/35 mb-2 flex items-center justify-between">
        <span className={cn('font-semibold tracking-[0.12em] uppercase', size.micro)}>
          Last 7 days
        </span>
        <span className={cn('tabular-nums', size.micro)}>{totalWeek} events</span>
      </div>
      <div className="flex items-end gap-1.5">
        {weeklySummary
          .slice()
          .reverse()
          .map((day, index) => {
            const total = day.commits + day.services_started + day.errors;
            const height = Math.max(4, (total / maxTotal) * 36);
            return (
              <div key={index} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    'w-full rounded-sm transition-all',
                    day.errors > 0 ? 'bg-rose-500/40' : total > 0 ? 'bg-accent/40' : 'bg-fg/5',
                  )}
                  style={{ height: `${height}px` }}
                  title={`${day.date} — ${total} event${total === 1 ? '' : 's'}${
                    day.errors > 0 ? ` · ${day.errors} errors` : ''
                  }`}
                />
                <span className={cn('text-fg/25 tabular-nums', size.micro)}>
                  {day.date.slice(8)}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
