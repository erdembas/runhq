import { invoke } from '@tauri-apps/api/core';
import type { DailySummary, TimelineEvent, TimelineEventType } from '@/types';

export const timelineIpc = {
  recordTimelineEvent: (
    eventType: TimelineEventType,
    serviceId?: string | null,
    serviceName?: string | null,
    description?: string,
    runId?: string | null,
  ) =>
    invoke<void>('record_timeline_event', {
      eventType,
      serviceId: serviceId ?? null,
      serviceName: serviceName ?? null,
      description: description ?? '',
      runId: runId ?? null,
    }),
  getTimeline: (
    serviceId?: string | null,
    eventType?: string | null,
    sinceMs?: number | null,
    limit?: number,
  ) =>
    invoke<TimelineEvent[]>('get_timeline', {
      serviceId: serviceId ?? null,
      eventType: eventType ?? null,
      sinceMs: sinceMs ?? null,
      limit,
    }),
  getDailySummary: (date: string) => invoke<DailySummary>('get_daily_summary', { date }),
  getWeeklySummary: (date: string) => invoke<DailySummary[]>('get_weekly_summary', { date }),
  exportStandup: (sinceMs: number) => invoke<string>('export_standup', { sinceMs }),
};
