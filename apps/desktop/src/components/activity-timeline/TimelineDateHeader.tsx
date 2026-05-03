import { XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TimelineEvent } from '@/types';
import type { TimelineSize } from './types';

interface TimelineDateHeaderProps {
  childrenByRun: Map<string, TimelineEvent[]>;
  events: TimelineEvent[];
  label: string;
  size: TimelineSize;
}

export function TimelineDateHeader({
  childrenByRun,
  events,
  label,
  size,
}: TimelineDateHeaderProps) {
  const seenRuns = new Set<string>();
  const errorsInGroup =
    events.filter(
      (event) => event.event_type === 'log_error' || event.event_type === 'service_crashed',
    ).length +
    events.reduce((count, event) => {
      if (!event.run_id || seenRuns.has(event.run_id)) return count;
      seenRuns.add(event.run_id);
      return (
        count +
        (childrenByRun.get(event.run_id)?.filter((child) => child.event_type === 'log_error')
          .length ?? 0)
      );
    }, 0);

  return (
    <div
      className={cn(
        'bg-surface border-border/30 sticky top-0 z-20 flex items-center gap-2 border-b',
        size.padX,
        'py-2',
      )}
    >
      <span className={cn('text-fg/65 font-semibold tracking-[0.12em] uppercase', size.meta)}>
        {label}
      </span>
      <span className={cn('text-fg/35 tabular-nums', size.micro)}>
        · {events.length} event{events.length === 1 ? '' : 's'}
      </span>
      {errorsInGroup > 0 && (
        <span
          className={cn(
            'ml-auto flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-medium text-rose-400 tabular-nums',
            size.micro,
          )}
          title={`${errorsInGroup} error${errorsInGroup === 1 ? '' : 's'} in this group`}
        >
          <XCircle size={10} />
          {errorsInGroup}
        </span>
      )}
    </div>
  );
}
