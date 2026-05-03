import { useMemo } from 'react';
import { dateBucket, formatDateHeader } from './model';
import type { TimelineGroup } from './types';
import type { TimelineEvent } from '@/types';

const CHILD_TYPES: TimelineEvent['event_type'][] = ['log_error', 'log_warning', 'file_changed'];
const LIFECYCLE_TYPES: TimelineEvent['event_type'][] = [
  'service_started',
  'service_stopped',
  'service_crashed',
];

export function useActivityTimelineDerived(
  events: TimelineEvent[],
  search: string,
  filterType: string | null,
) {
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const event of events) if (event.service_name) names.add(event.service_name);
    return Array.from(names).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;
    return events.filter(
      (event) =>
        event.description.toLowerCase().includes(query) ||
        (event.service_name ?? '').toLowerCase().includes(query) ||
        event.event_type.toLowerCase().includes(query),
    );
  }, [events, search]);

  const { visibleEvents, childrenByRun } = useMemo(() => {
    const empty = new Map<string, TimelineEvent[]>();
    if (filterType && CHILD_TYPES.includes(filterType as TimelineEvent['event_type'])) {
      return { visibleEvents: filteredEvents, childrenByRun: empty };
    }
    const runsWithLifecycle = new Set<string>();
    for (const event of filteredEvents) {
      if (event.run_id && LIFECYCLE_TYPES.includes(event.event_type)) {
        runsWithLifecycle.add(event.run_id);
      }
    }
    const children = new Map<string, TimelineEvent[]>();
    const hidden = new Set<number>();
    for (const event of filteredEvents) {
      if (!event.run_id) continue;
      if (!CHILD_TYPES.includes(event.event_type)) continue;
      if (!runsWithLifecycle.has(event.run_id)) continue;
      const list = children.get(event.run_id);
      if (list) list.push(event);
      else children.set(event.run_id, [event]);
      hidden.add(event.id);
    }
    return {
      visibleEvents: filteredEvents.filter((event) => !hidden.has(event.id)),
      childrenByRun: children,
    };
  }, [filteredEvents, filterType]);

  const grouped = useMemo<TimelineGroup[]>(() => {
    const groups: TimelineGroup[] = [];
    let currentBucket = '';
    for (const event of visibleEvents) {
      const bucket = dateBucket(event.timestamp);
      if (bucket !== currentBucket) {
        currentBucket = bucket;
        groups.push({ bucket, label: formatDateHeader(event.timestamp), events: [] });
      }
      groups[groups.length - 1]?.events.push(event);
    }
    return groups;
  }, [visibleEvents]);

  return { childrenByRun, filteredEvents, grouped, projectNames, visibleEvents };
}
