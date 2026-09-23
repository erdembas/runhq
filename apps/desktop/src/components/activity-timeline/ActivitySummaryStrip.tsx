import * as i18n from '@runhq/cockpit-ui/i18n';
import { cn } from '@/lib/cn';
import type { DailySummary } from '@/types';
import { SummaryStat } from './SummaryStat';
import type { TimelineSize } from './types';

interface ActivitySummaryStripProps {
  summary: DailySummary | null;
  size: TimelineSize;
}

export function ActivitySummaryStrip({ summary, size }: ActivitySummaryStripProps) {
  i18n.useLocale();
  if (!summary) return null;
  return (
    <div className={cn('flex items-center gap-2 py-2.5', size.padX)}>
      <SummaryStat
        tone="emerald"
        count={summary.services_started}
        label={i18n.t('starts')}
        size={size.meta}
      />
      <SummaryStat
        tone="violet"
        count={summary.commits}
        label={i18n.t('commits')}
        size={size.meta}
      />
      {summary.errors > 0 && (
        <SummaryStat tone="rose" count={summary.errors} label={i18n.t('errors')} size={size.meta} />
      )}
      <span
        className={cn('text-fg/30 ml-auto tabular-nums', size.micro)}
        title={i18n.t('Active across {value1} project{plural2}', {
          value1: summary.projects_worked,
          plural2: summary.projects_worked === 1 ? '' : 's',
        })}
      >
        {i18n.rich('{value1} proj', { value1: summary.projects_worked })}
      </span>
    </div>
  );
}
