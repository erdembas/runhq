import { cn } from '@/lib/cn';
import type { DailySummary } from '@/types';
import { SummaryStat } from './SummaryStat';
import type { TimelineSize } from './types';

interface ActivitySummaryStripProps {
  summary: DailySummary | null;
  size: TimelineSize;
}

export function ActivitySummaryStrip({ summary, size }: ActivitySummaryStripProps) {
  if (!summary) return null;
  return (
    <div className={cn('flex items-center gap-2 py-2.5', size.padX)}>
      <SummaryStat
        tone="emerald"
        count={summary.services_started}
        label="starts"
        size={size.meta}
      />
      <SummaryStat tone="violet" count={summary.commits} label="commits" size={size.meta} />
      {summary.errors > 0 && (
        <SummaryStat tone="rose" count={summary.errors} label="errors" size={size.meta} />
      )}
      <span
        className={cn('text-fg/30 ml-auto tabular-nums', size.micro)}
        title={`Active across ${summary.projects_worked} project${
          summary.projects_worked === 1 ? '' : 's'
        }`}
      >
        {summary.projects_worked} proj
      </span>
    </div>
  );
}
