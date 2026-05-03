import { useCallback, useMemo } from 'react';
import { logKey, useAppStore } from '@/store/useAppStore';
import {
  toConsoleLineFromDb,
  toConsoleLineFromLive,
  type ConsoleSection,
} from '@/components/activity/consoleModel';
import type { LogLine, TimelineEvent } from '@/types';

const LIFECYCLE_TYPES: TimelineEvent['event_type'][] = [
  'service_started',
  'service_stopped',
  'service_crashed',
];

export function useActivityConsoleSections(
  events: TimelineEvent[],
  childrenByRun: Map<string, TimelineEvent[]>,
) {
  const logsBySvc = useAppStore((state) => state.logs);
  const services = useAppStore((state) => state.services);

  const liveLinesByEventId = useMemo(() => {
    const bySvc: Record<string, TimelineEvent[]> = {};
    for (const event of events) {
      if (!event.service_id) continue;
      if (!LIFECYCLE_TYPES.includes(event.event_type)) continue;
      (bySvc[event.service_id] ||= []).push(event);
    }

    const result = new Map<number, Map<string, LogLine[]>>();
    for (const [serviceId, lifecycleEvents] of Object.entries(bySvc)) {
      const service = services.find((svc) => svc.id === serviceId);
      if (!service) continue;

      type CmdBuckets = {
        byRun: Map<string, LogLine[]>;
        orphans: LogLine[];
      };
      const perCmd = new Map<string, CmdBuckets>();
      let hasAnyLine = false;
      let hasAnyOrphan = false;

      for (const command of service.cmds) {
        const buffer = logsBySvc[logKey(serviceId, command.name)];
        if (!buffer || buffer.lines.length === 0) continue;
        hasAnyLine = true;
        const buckets: CmdBuckets = { byRun: new Map(), orphans: [] };
        for (const line of buffer.lines) {
          if (line.run_id) {
            const list = buckets.byRun.get(line.run_id);
            if (list) list.push(line);
            else buckets.byRun.set(line.run_id, [line]);
          } else {
            buckets.orphans.push(line);
            hasAnyOrphan = true;
          }
        }
        for (const list of buckets.byRun.values()) {
          list.sort((a, b) => a.ts_ms - b.ts_ms || a.seq - b.seq);
        }
        buckets.orphans.sort((a, b) => a.ts_ms - b.ts_ms || a.seq - b.seq);
        perCmd.set(command.name, buckets);
      }
      if (!hasAnyLine) continue;

      for (const event of lifecycleEvents) {
        if (!event.run_id) continue;
        const perCmdForEvent = new Map<string, LogLine[]>();
        for (const command of service.cmds) {
          const buckets = perCmd.get(command.name);
          if (!buckets) continue;
          const lines = buckets.byRun.get(event.run_id);
          if (lines && lines.length > 0) perCmdForEvent.set(command.name, lines);
        }
        if (perCmdForEvent.size > 0) result.set(event.id, perCmdForEvent);
      }

      const legacyEvents = lifecycleEvents.filter((event) => !event.run_id);
      if (legacyEvents.length === 0 || !hasAnyOrphan) continue;

      const sortedLifecycle = [...lifecycleEvents].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      for (let i = 0; i < sortedLifecycle.length; i++) {
        const event = sortedLifecycle[i]!;
        if (event.run_id) continue;
        const startMs = new Date(event.timestamp).getTime();
        const endMs =
          i + 1 < sortedLifecycle.length
            ? new Date(sortedLifecycle[i + 1]!.timestamp).getTime()
            : Date.now() + 1000;
        const perCmdForEvent = new Map<string, LogLine[]>();
        for (const command of service.cmds) {
          const buckets = perCmd.get(command.name);
          if (!buckets || buckets.orphans.length === 0) continue;
          const windowLines = buckets.orphans.filter(
            (line) => line.ts_ms >= startMs && line.ts_ms < endMs,
          );
          if (windowLines.length > 0) perCmdForEvent.set(command.name, windowLines);
        }
        if (perCmdForEvent.size > 0) result.set(event.id, perCmdForEvent);
      }
    }
    return result;
  }, [events, logsBySvc, services]);

  return useCallback(
    (event: TimelineEvent): ConsoleSection[] => {
      const live = liveLinesByEventId.get(event.id);
      if (live && live.size > 0) {
        const sections: ConsoleSection[] = [];
        const service = event.service_id
          ? services.find((svc) => svc.id === event.service_id)
          : undefined;
        const orderedNames = service
          ? service.cmds.map((command) => command.name)
          : [...live.keys()];
        for (const name of orderedNames) {
          const lines = live.get(name);
          if (!lines || lines.length === 0) continue;
          const consoleLines = lines.map(toConsoleLineFromLive);
          sections.push({
            key: `cmd::${name}`,
            label: name,
            lines: consoleLines,
            errors: consoleLines.filter((line) => line.severity === 'error').length,
            warnings: consoleLines.filter((line) => line.severity === 'warn').length,
          });
        }
        if (sections.length > 0) return sections;
      }

      const dbChildren = event.run_id ? childrenByRun.get(event.run_id) : undefined;
      if (!dbChildren || dbChildren.length === 0) return [];
      const consoleLines = dbChildren.map(toConsoleLineFromDb);
      return [
        {
          key: 'all',
          label: 'All',
          lines: consoleLines,
          errors: consoleLines.filter((line) => line.severity === 'error').length,
          warnings: consoleLines.filter((line) => line.severity === 'warn').length,
        },
      ];
    },
    [liveLinesByEventId, childrenByRun, services],
  );
}
