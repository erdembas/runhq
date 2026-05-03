import type { ReactNode, RefObject } from 'react';
import type { makeAnsiConverter } from '@/lib/ansi';
import type { ConsoleSection } from '@/components/activity/consoleModel';
import type { DailySummary, TimelineEvent } from '@/types';

export interface ActivityTimelineProps {
  onClose?: () => void;
  variant?: 'overlay' | 'inline';
  embedded?: boolean;
}

export interface TimelineSize {
  padX: string;
  headerPY: string;
  title: string;
  body: string;
  meta: string;
  micro: string;
  iconWrap: string;
  sevIcon: number;
}

export interface TimelineGroup {
  bucket: string;
  label: string;
  events: TimelineEvent[];
}

export interface TimelineEventConfig {
  color: string;
  bg: string;
  ring: string;
  accent: string;
  label: string;
  severity: 0 | 1 | 2;
}

export interface AiSurfaceTriggerHandle {
  triggerRef: RefObject<HTMLButtonElement>;
  onClick: () => void;
  popover: ReactNode;
}

export type ConsoleSectionsFor = (event: TimelineEvent) => ConsoleSection[];

export interface TimelineAnsi {
  ansi: ReturnType<typeof makeAnsiConverter>;
  isDark: boolean;
}

export interface TimelineSummaryData {
  summary: DailySummary | null;
  weeklySummary: DailySummary[] | null;
}
