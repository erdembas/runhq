import { cn } from '@/lib/cn';
import type { TimelineEvent } from '@/types';
import { formatTime } from './model';
import type { TimelineSize } from './types';

interface ActivityTimelineFooterProps {
  eventCount: number;
  filteredCount: number;
  selectedEvent: TimelineEvent | null;
  size: TimelineSize;
}

export function ActivityTimelineFooter({
  eventCount,
  filteredCount,
  selectedEvent,
  size,
}: ActivityTimelineFooterProps) {
  return (
    <div className={cn('border-border/40 border-t py-2', size.padX)}>
      <div className={cn('text-fg/40 flex items-center justify-between', size.micro)}>
        <span className="tabular-nums">
          {filteredCount === eventCount
            ? `${eventCount} event${eventCount === 1 ? '' : 's'}`
            : `${filteredCount} of ${eventCount}`}
        </span>
        {selectedEvent ? (
          <span className="text-fg/50 flex items-center gap-1.5">
            <span className="font-mono tabular-nums">#{selectedEvent.id}</span>
            <span className="text-fg/25">·</span>
            <span>{formatTime(selectedEvent.timestamp)}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500/70" />
            <span className="tracking-wide uppercase">Live</span>
          </span>
        )}
      </div>
    </div>
  );
}
