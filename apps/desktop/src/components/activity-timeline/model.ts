import {
  Activity,
  AlertTriangle,
  Bug,
  FileEdit,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Play,
  Square,
  XCircle,
  Zap,
} from 'lucide-react';
import type { TimelineEventConfig, TimelineSize } from '@/components/activity-timeline/types';
import type { TimelineEvent } from '@/types';

export const eventConfig: Record<string, TimelineEventConfig> = {
  service_started: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    ring: 'ring-emerald-500/30',
    accent: 'bg-emerald-500/60',
    label: 'Started',
    severity: 0,
  },
  service_stopped: {
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    ring: 'ring-slate-500/20',
    accent: 'bg-slate-500/40',
    label: 'Stopped',
    severity: 0,
  },
  service_crashed: {
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    ring: 'ring-red-500/30',
    accent: 'bg-red-500/70',
    label: 'Crashed',
    severity: 2,
  },
  git_commit: {
    color: 'text-violet-400',
    bg: 'bg-violet-500/15',
    ring: 'ring-violet-500/30',
    accent: 'bg-violet-500/60',
    label: 'Commit',
    severity: 0,
  },
  git_push: {
    color: 'text-fuchsia-400',
    bg: 'bg-fuchsia-500/15',
    ring: 'ring-fuchsia-500/30',
    accent: 'bg-fuchsia-500/60',
    label: 'Push',
    severity: 0,
  },
  git_pull: {
    color: 'text-teal-400',
    bg: 'bg-teal-500/15',
    ring: 'ring-teal-500/30',
    accent: 'bg-teal-500/60',
    label: 'Pull',
    severity: 0,
  },
  git_checkout: {
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    ring: 'ring-cyan-500/30',
    accent: 'bg-cyan-500/60',
    label: 'Checkout',
    severity: 0,
  },
  git_branch_created: {
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/15',
    ring: 'ring-indigo-500/30',
    accent: 'bg-indigo-500/60',
    label: 'Branch',
    severity: 0,
  },
  git_stash: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    accent: 'bg-amber-500/60',
    label: 'Stash',
    severity: 0,
  },
  log_error: {
    color: 'text-rose-400',
    bg: 'bg-rose-500/15',
    ring: 'ring-rose-500/30',
    accent: 'bg-rose-500/70',
    label: 'Error',
    severity: 2,
  },
  log_warning: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    accent: 'bg-amber-500/60',
    label: 'Warning',
    severity: 1,
  },
  file_changed: {
    color: 'text-sky-400',
    bg: 'bg-sky-500/15',
    ring: 'ring-sky-500/30',
    accent: 'bg-sky-500/50',
    label: 'File Changed',
    severity: 0,
  },
};

export const defaultConfig: TimelineEventConfig = {
  color: 'text-fg/50',
  bg: 'bg-fg/5',
  ring: 'ring-fg/10',
  accent: 'bg-fg/20',
  label: 'Event',
  severity: 0,
};

export const eventIcons = {
  Activity,
  AlertTriangle,
  Bug,
  FileEdit,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Play,
  Square,
  XCircle,
  Zap,
};

export const TIME_RANGES: Array<{ key: string; label: string; ms: () => number }> = [
  { key: '1h', label: '1h', ms: () => 3_600_000 },
  { key: '24h', label: '24h', ms: () => 86_400_000 },
  { key: '7d', label: '7d', ms: () => 86_400_000 * 7 },
  { key: '30d', label: '30d', ms: () => 86_400_000 * 30 },
  { key: 'all', label: 'All', ms: () => 0 },
];

export const FILTER_PILLS: Array<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'service_started', label: 'Starts' },
  { key: 'service_crashed', label: 'Crashes' },
  { key: 'log_error', label: 'Errors' },
  { key: 'log_warning', label: 'Warns' },
  { key: 'git_commit', label: 'Commits' },
  { key: 'git_push', label: 'Pushes' },
  { key: 'git_pull', label: 'Pulls' },
  { key: 'file_changed', label: 'Files' },
];

export const TIMELINE_COLLAPSED_W = 44;
export const TIMELINE_MIN_W = 400;
export const TIMELINE_MAX_W = 600;
export const TIMELINE_DEFAULT_W = 420;
export const HOVER_OPEN_DELAY_MS = 120;
export const HOVER_CLOSE_DELAY_MS = 220;
export const REFRESH_INTERVAL_MS = 12_000;
export const TIME_TICK_MS = 30_000;

const TIMELINE_COLLAPSED_KEY = 'runhq.timeline.collapsed.v1';
const TIMELINE_WIDTH_KEY = 'runhq.timeline.width.v1';

export function nameHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatDateHeader(ts: string): string {
  try {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function dateBucket(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function timeAgo(tsMs: number, now: number): string {
  const diff = now - tsMs;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function getTimeSince(key: string): number | null {
  const found = TIME_RANGES.find((t) => t.key === key);
  if (!found || found.key === 'all') return null;
  return Date.now() - found.ms();
}

export function loadTimelineCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TIMELINE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTimelineCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMELINE_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // non-fatal
  }
}

export function loadTimelineWidth(): number {
  if (typeof window === 'undefined') return TIMELINE_DEFAULT_W;
  try {
    const raw = window.localStorage.getItem(TIMELINE_WIDTH_KEY);
    if (raw == null) return TIMELINE_DEFAULT_W;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return TIMELINE_DEFAULT_W;
    return Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, n));
  } catch {
    return TIMELINE_DEFAULT_W;
  }
}

export function saveTimelineWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMELINE_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // non-fatal
  }
}

export function syncTimelineStorage(
  event: StorageEvent,
  onCollapsed: (collapsed: boolean) => void,
  onWidth: (width: number) => void,
): void {
  if (event.key === TIMELINE_COLLAPSED_KEY) {
    onCollapsed(event.newValue === '1');
    return;
  }
  if (event.key === TIMELINE_WIDTH_KEY && event.newValue != null) {
    const n = Number.parseInt(event.newValue, 10);
    if (Number.isFinite(n)) onWidth(Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, n)));
  }
}

export function timelineSize(isInline: boolean): TimelineSize {
  return isInline
    ? {
        padX: 'px-4',
        headerPY: 'py-2.5',
        title: 'text-[13px]',
        body: 'text-[12px]',
        meta: 'text-[11px]',
        micro: 'text-[10.5px]',
        iconWrap: 'h-5 w-5',
        sevIcon: 22,
      }
    : {
        padX: 'px-6',
        headerPY: 'py-3.5',
        title: 'text-[14px]',
        body: 'text-[13px]',
        meta: 'text-[11.5px]',
        micro: 'text-[11px]',
        iconWrap: 'h-6 w-6',
        sevIcon: 24,
      };
}

export function activityFilterCount(
  filterType: string | null,
  filterProject: string | null,
  timeRange: string,
  search: string,
): number {
  return (
    (filterType ? 1 : 0) +
    (filterProject ? 1 : 0) +
    (timeRange !== '24h' && timeRange !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0)
  );
}

export function splitEventDescription(event: TimelineEvent): { heading: string; body: string } {
  const firstBreak = event.description.indexOf('\n');
  return {
    heading: firstBreak === -1 ? event.description : event.description.slice(0, firstBreak).trim(),
    body: firstBreak === -1 ? '' : event.description.slice(firstBreak + 1).trim(),
  };
}
