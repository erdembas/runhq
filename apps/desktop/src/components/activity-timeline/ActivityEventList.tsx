import type { makeAnsiConverter } from '@/lib/ansi';
import type { TimelineEvent } from '@/types';
import { ListSkeleton } from './ListSkeleton';
import { ActivityEventRow } from './ActivityEventRow';
import { TimelineDateHeader } from './TimelineDateHeader';
import { TimelineEmptyState } from './TimelineEmptyState';
import type { ConsoleSectionsFor, TimelineGroup, TimelineSize } from './types';

interface ActivityEventListProps {
  activeFilterCount: number;
  ansi: ReturnType<typeof makeAnsiConverter>;
  childrenByRun: Map<string, TimelineEvent[]>;
  clearFilters: () => void;
  consoleSectionsFor: ConsoleSectionsFor;
  detailCopied: boolean;
  events: TimelineEvent[];
  filteredEvents: TimelineEvent[];
  grouped: TimelineGroup[];
  isDark: boolean;
  isInline: boolean;
  loading: boolean;
  now: number;
  onCopyEvent: (event: TimelineEvent) => void;
  search: string;
  selectedId: number | null;
  setModalEventId: (id: number | null) => void;
  setSearch: (value: string) => void;
  setSelectedId: (id: number | null) => void;
  size: TimelineSize;
}

export function ActivityEventList({
  activeFilterCount,
  ansi,
  childrenByRun,
  clearFilters,
  consoleSectionsFor,
  detailCopied,
  events,
  filteredEvents,
  grouped,
  isDark,
  isInline,
  loading,
  now,
  onCopyEvent,
  search,
  selectedId,
  setModalEventId,
  setSearch,
  setSelectedId,
  size,
}: ActivityEventListProps) {
  return (
    <div className="overlay-scroll min-h-0 flex-1 overflow-auto">
      {loading && events.length === 0 && <ListSkeleton isInline={isInline} padX={size.padX} />}
      {!loading && filteredEvents.length === 0 && (
        <TimelineEmptyState
          activeFilterCount={activeFilterCount}
          clearFilters={clearFilters}
          search={search}
          setSearch={setSearch}
          size={size}
        />
      )}
      {grouped.map((group) => (
        <div key={group.bucket}>
          <TimelineDateHeader
            childrenByRun={childrenByRun}
            events={group.events}
            label={group.label}
            size={size}
          />
          <div>
            {group.events.map((event, index) => (
              <ActivityEventRow
                key={event.id}
                ansi={ansi}
                consoleSections={consoleSectionsFor(event)}
                detailCopied={detailCopied}
                event={event}
                isDark={isDark}
                isFirst={index === 0}
                isInline={isInline}
                isLast={index === group.events.length - 1}
                now={now}
                onClose={() => setSelectedId(null)}
                onCopy={onCopyEvent}
                onOpenModal={() => setModalEventId(event.id)}
                onToggle={() => setSelectedId(selectedId === event.id ? null : event.id)}
                selected={selectedId === event.id}
                size={size}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
