import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Square,
  AlertTriangle,
  GitCommitHorizontal,
  GitMerge,
  GitBranch,
  RefreshCw,
  Copy,
  Zap,
  Bug,
  XCircle,
  FileEdit,
  X,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Activity,
  Search,
  FilterX,
  Check,
  Maximize2,
} from 'lucide-react';
import { ipc, events as ipcEvents } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { TimelineEvent, DailySummary } from '@/types';
import { Select } from './ui/Select';
import { Dialog } from './ui/Dialog';

/** Stable hue derived from a service/project name — same string → same color. */
function nameHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

interface ActivityTimelineProps {
  onClose?: () => void;
  variant?: 'overlay' | 'inline';
}

// ─────────────────────────────────────────────────────────────────────────
// Visual config per event type — single source of truth for icon / colors.
// `accent` drives the 2px severity strip on the left edge of each row.
// ─────────────────────────────────────────────────────────────────────────
const eventConfig: Record<
  string,
  {
    icon: typeof Play;
    color: string;
    bg: string;
    ring: string;
    accent: string;
    label: string;
    severity: 0 | 1 | 2; // 0=info, 1=warn, 2=error
  }
> = {
  service_started: {
    icon: Play,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    ring: 'ring-emerald-500/30',
    accent: 'bg-emerald-500/60',
    label: 'Started',
    severity: 0,
  },
  service_stopped: {
    icon: Square,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    ring: 'ring-slate-500/20',
    accent: 'bg-slate-500/40',
    label: 'Stopped',
    severity: 0,
  },
  service_crashed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    ring: 'ring-red-500/30',
    accent: 'bg-red-500/70',
    label: 'Crashed',
    severity: 2,
  },
  git_commit: {
    icon: GitCommitHorizontal,
    color: 'text-violet-400',
    bg: 'bg-violet-500/15',
    ring: 'ring-violet-500/30',
    accent: 'bg-violet-500/60',
    label: 'Commit',
    severity: 0,
  },
  git_push: {
    icon: GitMerge,
    color: 'text-fuchsia-400',
    bg: 'bg-fuchsia-500/15',
    ring: 'ring-fuchsia-500/30',
    accent: 'bg-fuchsia-500/60',
    label: 'Push',
    severity: 0,
  },
  git_pull: {
    icon: GitMerge,
    color: 'text-teal-400',
    bg: 'bg-teal-500/15',
    ring: 'ring-teal-500/30',
    accent: 'bg-teal-500/60',
    label: 'Pull',
    severity: 0,
  },
  git_checkout: {
    icon: GitBranch,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    ring: 'ring-cyan-500/30',
    accent: 'bg-cyan-500/60',
    label: 'Checkout',
    severity: 0,
  },
  git_branch_created: {
    icon: GitBranch,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/15',
    ring: 'ring-indigo-500/30',
    accent: 'bg-indigo-500/60',
    label: 'Branch',
    severity: 0,
  },
  git_stash: {
    icon: FileEdit,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    accent: 'bg-amber-500/60',
    label: 'Stash',
    severity: 0,
  },
  log_error: {
    icon: Bug,
    color: 'text-rose-400',
    bg: 'bg-rose-500/15',
    ring: 'ring-rose-500/30',
    accent: 'bg-rose-500/70',
    label: 'Error',
    severity: 2,
  },
  log_warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    accent: 'bg-amber-500/60',
    label: 'Warning',
    severity: 1,
  },
  file_changed: {
    icon: FileEdit,
    color: 'text-sky-400',
    bg: 'bg-sky-500/15',
    ring: 'ring-sky-500/30',
    accent: 'bg-sky-500/50',
    label: 'File Changed',
    severity: 0,
  },
};

const defaultConfig = {
  icon: Zap,
  color: 'text-fg/50',
  bg: 'bg-fg/5',
  ring: 'ring-fg/10',
  accent: 'bg-fg/20',
  label: 'Event',
  severity: 0 as const,
};

function formatTime(ts: string): string {
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

function formatDateHeader(ts: string): string {
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

function dateBucket(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function timeAgo(tsMs: number, now: number): string {
  const diff = now - tsMs;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TIME_RANGES: Array<{ key: string; label: string; ms: () => number }> = [
  { key: '1h', label: '1h', ms: () => 3_600_000 },
  { key: '24h', label: '24h', ms: () => 86_400_000 },
  { key: '7d', label: '7d', ms: () => 86_400_000 * 7 },
  { key: '30d', label: '30d', ms: () => 86_400_000 * 30 },
  { key: 'all', label: 'All', ms: () => 0 },
];

function getTimeSince(key: string): number | null {
  const found = TIME_RANGES.find((t) => t.key === key);
  if (!found || found.key === 'all') return null;
  return Date.now() - found.ms();
}

const TIMELINE_COLLAPSED_KEY = 'runhq.timeline.collapsed.v1';

function loadTimelineCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TIMELINE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveTimelineCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMELINE_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // non-fatal
  }
}

// Hover debounce: short open avoids flicker when the cursor grazes the rail
// in passing; longer close keeps the panel up if the user briefly strays.
const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 220;

// Background refresh cadence. The DB query is cheap (indexed, LIMIT 500) but
// we still skip work when the panel is hidden.
const REFRESH_INTERVAL_MS = 12_000;

// How often the relative "5m ago" labels tick forward. 30s is the sweet spot
// — long enough to avoid layout churn, short enough that "just now" becomes
// "1m ago" before it feels stale.
const TIME_TICK_MS = 30_000;

const FILTER_PILLS: Array<{ key: string; label: string }> = [
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

export function ActivityTimeline({ onClose, variant = 'overlay' }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<DailySummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('24h');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalEventId, setModalEventId] = useState<number | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);
  const [standupCopied, setStandupCopied] = useState(false);
  const [detailCopied, setDetailCopied] = useState(false);
  const [collapsed, setCollapsedState] = useState<boolean>(() => loadTimelineCollapsed());
  const [hoverOpen, setHoverOpen] = useState(false);

  // ─────────────── Persistence of pin/collapse state ───────────────
  // Single source of truth: whenever `collapsed` flips, mirror it to
  // localStorage. This covers every code path that might mutate it
  // (pin button, collapse button, keyboard shortcuts, hydration) without
  // relying on every caller to remember to persist.
  useEffect(() => {
    saveTimelineCollapsed(collapsed);
  }, [collapsed]);

  // Cross-tab / cross-window sync — if another Runhq window toggles the
  // pin state, reflect it here too. Harmless no-op in single-window usage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TIMELINE_COLLAPSED_KEY) return;
      setCollapsedState(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const [now, setNow] = useState(() => Date.now());

  const hoverTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const isInline = variant === 'inline';

  // ─────────────── Collapse toggle ───────────────
  // Persistence happens automatically via the effect above. This wrapper only
  // exists to also clear the hover-peek flag when the user explicitly pins,
  // so the peek state doesn't linger on top of the pinned-open panel.
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    if (!next) setHoverOpen(false);
  }, []);

  // ─────────────── Hover timer management ───────────────
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const scheduleHoverOpen = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverOpen(true);
      hoverTimerRef.current = null;
    }, HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer]);
  const scheduleHoverClose = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverOpen(false);
      hoverTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // ─────────────── Data loading ───────────────
  const today = new Date().toISOString().split('T')[0] ?? '';

  const refresh = useCallback(
    async (opts: { showLoader?: boolean } = {}) => {
      if (opts.showLoader !== false) setLoading(true);
      try {
        const sinceMs = getTimeSince(timeRange);
        const [evts, sum, weekly] = await Promise.all([
          ipc.getTimeline(filterProject, filterType, sinceMs, 500),
          ipc.getDailySummary(today),
          ipc.getWeeklySummary(today),
        ]);
        setEvents(evts);
        setSummary(sum);
        setWeeklySummary(weekly);
      } catch (err) {
        console.error('Failed to load timeline', err);
      } finally {
        setLoading(false);
      }
    },
    [filterType, filterProject, timeRange, today],
  );

  // Initial + filter-change refresh.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Periodic background refresh — silent (no loader flash). Only runs while
  // the panel is visible (not collapsed + no hover peek).
  useEffect(() => {
    const panelVisible = isInline ? !collapsed || hoverOpen : true;
    if (!panelVisible) return;
    const id = window.setInterval(() => {
      void refresh({ showLoader: false });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isInline, collapsed, hoverOpen, refresh]);

  // Live time ticker — bumps `now` so `timeAgo()` stays current without a
  // full data reload.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TIME_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // React to upstream service lifecycle / stderr events — each one typically
  // produces a timeline insert on the Rust side, so refresh quickly (with a
  // short debounce to coalesce bursts, e.g. a crash loop spewing stderr).
  useEffect(() => {
    let debounce: number | null = null;
    const trigger = () => {
      if (debounce !== null) return;
      debounce = window.setTimeout(() => {
        debounce = null;
        void refresh({ showLoader: false });
      }, 400);
    };
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(await ipcEvents.onStatus(trigger));
      unsubs.push(
        await ipcEvents.onLog((ev) => {
          if (ev.line.stream !== 'stderr') return;
          const t = ev.line.text.toLowerCase();
          if (
            t.includes('error') ||
            t.includes('warn') ||
            t.includes('fatal') ||
            t.includes('panic')
          ) {
            trigger();
          }
        }),
      );
    })();
    return () => {
      if (debounce !== null) window.clearTimeout(debounce);
      unsubs.forEach((u) => u());
    };
  }, [refresh]);

  // ─────────────── Keyboard ───────────────
  useEffect(() => {
    const panelVisible = isInline ? !collapsed || hoverOpen : true;
    if (!panelVisible) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === 'Escape') {
        if (modalEventId !== null) {
          setModalEventId(null);
          return;
        }
        if (editable && target === searchInputRef.current) {
          setSearch('');
          searchInputRef.current?.blur();
          return;
        }
        if (selectedId !== null) {
          setSelectedId(null);
          return;
        }
        if (!isInline && onClose) onClose();
      }
      if (e.key === '/' && !editable) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isInline, collapsed, hoverOpen, selectedId, modalEventId, onClose]);

  // ─────────────── Actions ───────────────
  const handleExportStandup = useCallback(async () => {
    try {
      const since = Date.now() - 86_400_000;
      const text = await ipc.exportStandup(since);
      await writeText(text);
      setStandupCopied(true);
      setTimeout(() => setStandupCopied(false), 1800);
    } catch (err) {
      console.error('Failed to export standup', err);
    }
  }, []);

  const handleCopyDetail = useCallback(async (e: TimelineEvent) => {
    try {
      const header = `[${formatTime(e.timestamp)}] ${e.event_type}${
        e.service_name ? ` · ${e.service_name}` : ''
      }`;
      const body = `${header}\n${e.description}`;
      await writeText(body);
      setDetailCopied(true);
      setTimeout(() => setDetailCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy event', err);
    }
  }, []);

  const clearFilters = useCallback(() => {
    setFilterType(null);
    setFilterProject(null);
    setTimeRange('24h');
    setSearch('');
  }, []);

  // ─────────────── Derived data ───────────────
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const e of events) if (e.service_name) names.add(e.service_name);
    return Array.from(names).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.description.toLowerCase().includes(q) ||
        (e.service_name ?? '').toLowerCase().includes(q) ||
        e.event_type.toLowerCase().includes(q),
    );
  }, [events, search]);

  const grouped = useMemo(() => {
    const groups: Array<{ bucket: string; label: string; events: TimelineEvent[] }> = [];
    let currentBucket = '';
    for (const e of filteredEvents) {
      const b = dateBucket(e.timestamp);
      if (b !== currentBucket) {
        currentBucket = b;
        groups.push({ bucket: b, label: formatDateHeader(e.timestamp), events: [] });
      }
      groups[groups.length - 1]?.events.push(e);
    }
    return groups;
  }, [filteredEvents]);

  const activeFilterCount =
    (filterType ? 1 : 0) +
    (filterProject ? 1 : 0) +
    (timeRange !== '24h' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const selectedEvent = events.find((e) => e.id === selectedId) ?? null;
  const modalEvent =
    modalEventId !== null ? (events.find((e) => e.id === modalEventId) ?? null) : null;

  // ─────────────── Shared typography scale ───────────────
  // One rhythm across inline/overlay so they feel like the same component at
  // two densities. Text sizes are deliberately larger than before — the old
  // 9-10px feed felt cramped and unreadable at arm's length.
  const size = isInline
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

  const renderSummaryStrip = () => {
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
  };

  const renderWeeklySparkline = () => {
    if (!showWeekly || !weeklySummary || weeklySummary.length === 0) return null;
    const maxTotal = Math.max(
      ...weeklySummary.map((s) => s.commits + s.services_started + s.errors),
      1,
    );
    const totalWeek = weeklySummary.reduce(
      (n, s) => n + s.commits + s.services_started + s.errors,
      0,
    );
    return (
      <div className={cn('border-border/40 border-t py-3', size.padX)}>
        <div className="text-fg/35 mb-2 flex items-center justify-between">
          <span className={cn('font-semibold tracking-[0.12em] uppercase', size.micro)}>
            Last 7 days
          </span>
          <span className={cn('tabular-nums', size.micro)}>{totalWeek} events</span>
        </div>
        <div className="flex items-end gap-1.5">
          {weeklySummary
            .slice()
            .reverse()
            .map((d, i) => {
              const total = d.commits + d.services_started + d.errors;
              const h = Math.max(4, (total / maxTotal) * 36);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={cn(
                      'w-full rounded-sm transition-all',
                      d.errors > 0 ? 'bg-rose-500/40' : total > 0 ? 'bg-accent/40' : 'bg-fg/5',
                    )}
                    style={{ height: `${h}px` }}
                    title={`${d.date} — ${total} event${total === 1 ? '' : 's'}${
                      d.errors > 0 ? ` · ${d.errors} errors` : ''
                    }`}
                  />
                  <span className={cn('text-fg/25 tabular-nums', size.micro)}>
                    {d.date.slice(8)}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    );
  };

  const renderFilters = () => (
    <div className={cn('border-border/40 space-y-2 border-t py-2.5', size.padX)}>
      {/* Search — prominent, bigger, filter-clear inline */}
      <div className="flex items-center gap-2">
        <div className="bg-surface-muted/40 border-border/40 focus-within:border-accent/50 focus-within:bg-surface relative flex flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 transition">
          <Search size={13} className="text-fg/35 shrink-0" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className={cn(
              'placeholder:text-fg/30 text-fg/85 min-w-0 flex-1 bg-transparent outline-none',
              size.body,
            )}
            aria-label="Search timeline events"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              className="text-fg/30 hover:text-fg/70 shrink-0"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd
              className={cn(
                'text-fg/35 border-border/40 bg-surface/60 shrink-0 rounded border px-1 font-mono',
                'text-[10px]',
              )}
            >
              /
            </kbd>
          )}
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className={cn(
              'hover:bg-fg/8 text-fg/50 hover:text-fg/80 flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 font-medium transition',
              size.micro,
            )}
            title={`Clear ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}`}
          >
            <FilterX size={12} />
            <span className="tabular-nums">{activeFilterCount}</span>
          </button>
        )}
      </div>

      {/* Type pills — horizontal scroll */}
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
        {FILTER_PILLS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterType(f.key || null)}
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 font-medium transition',
              size.micro,
              (filterType ?? '') === f.key
                ? 'bg-accent/15 text-accent'
                : 'text-fg/45 hover:bg-fg/5 hover:text-fg/75',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Project + time range + week toggle */}
      <div className="flex items-center gap-2">
        <Select
          value={filterProject ?? ''}
          onChange={(v) => setFilterProject(v || null)}
          options={[
            { value: '', label: 'All projects' },
            ...projectNames.map((n) => ({ value: n, label: n, hue: nameHue(n) })),
          ]}
          placeholder="All projects"
          ariaLabel="Filter by project"
          size="sm"
          className="min-w-0 flex-1"
        />
        <div className="border-border/40 bg-surface-muted/30 flex items-center gap-0.5 rounded-md border px-0.5 py-0.5">
          {TIME_RANGES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTimeRange(t.key)}
              className={cn(
                'rounded px-1.5 py-0.5 font-medium tabular-nums transition',
                size.micro,
                timeRange === t.key
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg/40 hover:bg-fg/5 hover:text-fg/70',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowWeekly((v) => !v)}
          className={cn(
            'rounded-md px-2 py-1 font-medium transition',
            size.micro,
            showWeekly ? 'bg-accent/15 text-accent' : 'text-fg/40 hover:bg-fg/5 hover:text-fg/70',
          )}
          title={showWeekly ? 'Hide weekly sparkline' : 'Show weekly sparkline'}
          aria-pressed={showWeekly}
        >
          Week
        </button>
      </div>
    </div>
  );

  const renderEventRow = (e: TimelineEvent, isFirst: boolean, isLast: boolean) => {
    const cfg = eventConfig[e.event_type] ?? defaultConfig;
    // Single universal glyph — we convey type through the colored badge+tint,
    // not the icon shape. Keeps the feed visually calm on dense days.
    const Icon = Zap;
    const isSelected = selectedId === e.id;
    const tsMs = new Date(e.timestamp).getTime();
    const isFresh = Date.now() - tsMs < 10_000;

    const sevTint =
      cfg.severity === 2
        ? 'hover:bg-rose-500/3'
        : cfg.severity === 1
          ? 'hover:bg-amber-500/2.5'
          : 'hover:bg-fg/2.5';

    // Icon center Y offset from row top. Button has py-3 (12px) top padding,
    // then the dot sits at items-start — its center lands at 12 + radius.
    const iconCenter = 12 + size.sevIcon / 2;
    // Horizontal offset of the rail (dot center) from the left edge of the row.
    // padX is 16px (inline, px-4) or 24px (overlay, px-6); dot occupies sevIcon
    // width and we want the line to pass through its center.
    const railLeftPx = (isInline ? 16 : 24) + size.sevIcon / 2;

    return (
      <div
        key={e.id}
        className={cn(
          'group relative transition-colors',
          sevTint,
          isSelected && 'bg-fg/3',
          cfg.severity === 2 && 'bg-rose-500/2',
        )}
      >
        {/* Git-history connector line — absolute, full-row, masked by opaque dot */}
        {!isFirst && (
          <span
            aria-hidden
            className="bg-border/70 absolute top-0 w-px -translate-x-1/2"
            style={{ left: railLeftPx, height: iconCenter }}
          />
        )}
        {!isLast && (
          <span
            aria-hidden
            className="bg-border/70 absolute bottom-0 w-px -translate-x-1/2"
            style={{ left: railLeftPx, top: iconCenter }}
          />
        )}
        <button
          type="button"
          onClick={() => setSelectedId(isSelected ? null : e.id)}
          className={cn('flex w-full items-start gap-3 text-left', size.padX, 'py-3')}
          aria-expanded={isSelected}
        >
          {/* Dot — opaque so it masks the connector line behind it */}
          <div
            className={cn(
              'bg-surface border-border relative z-10 flex shrink-0 items-center justify-center rounded-full border transition',
              'group-hover:border-fg/30',
              isSelected && 'border-fg/40',
            )}
            style={{ height: size.sevIcon, width: size.sevIcon }}
          >
            <Icon
              size={Math.floor(size.sevIcon / 1.8)}
              className="text-fg/55 shrink-0"
              strokeWidth={2.25}
            />
          </div>

          {/* Content column */}
          <div className="min-w-0 flex-1">
            {/* Title row — event BADGE · subtle project · time */}
            <div className="flex items-center gap-2">
              <EventBadge cfg={cfg} size={size.micro} />
              {e.service_name && (
                <span
                  className={cn('text-fg/45 min-w-0 truncate font-medium', size.meta)}
                  title={e.service_name}
                >
                  {e.service_name}
                </span>
              )}
              {isFresh && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-400"
                  title="Just now"
                >
                  <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
                  <span className={cn('tracking-wide uppercase', size.micro)}>new</span>
                </span>
              )}
              <span
                className={cn('text-fg/40 ml-auto shrink-0 tabular-nums', size.meta)}
                title={`${formatTime(e.timestamp)} · id #${e.id}`}
              >
                {timeAgo(tsMs, now)}
              </span>
            </div>

            {/* Preview (collapsed) — first line, 2-line clamp */}
            {!isSelected && (
              <p
                className={cn(
                  'text-fg/70 mt-1.5 line-clamp-2 leading-relaxed wrap-break-word',
                  size.body,
                )}
              >
                {e.description}
              </p>
            )}

            {/* Expanded detail — heading + body + minimalist metadata */}
            {isSelected &&
              (() => {
                // Split description into a title (first line) and an optional
                // body (the rest). For stack traces this gives a clean
                // "ErrorType: message" heading over the trace body.
                const firstBreak = e.description.indexOf('\n');
                const heading =
                  firstBreak === -1 ? e.description : e.description.slice(0, firstBreak).trim();
                const body = firstBreak === -1 ? '' : e.description.slice(firstBreak + 1).trim();

                return (
                  <div className="mt-3" onClick={(ev) => ev.stopPropagation()} role="presentation">
                    {/* Heading — the clear, minimalist title */}
                    <h4
                      className={cn(
                        'text-fg leading-snug font-semibold wrap-break-word',
                        size.title,
                      )}
                    >
                      {heading}
                    </h4>

                    {/* Body — full log / stack trace, monospace, scrollable */}
                    {body && (
                      <pre
                        className={cn(
                          'overlay-scroll text-fg/70 border-border/30 bg-fg/3 mt-3 max-h-72 overflow-auto rounded-md border px-3 py-2.5 font-mono leading-relaxed whitespace-pre-wrap',
                          size.meta,
                        )}
                      >
                        {body}
                      </pre>
                    )}

                    {/* Minimalist footer — meta dots + actions */}
                    <div className="mt-3 flex items-center gap-3">
                      <span
                        className={cn(
                          'text-fg/40 flex items-center gap-1.5 tabular-nums',
                          size.micro,
                        )}
                        title={`${formatTime(e.timestamp)} · id #${e.id}`}
                      >
                        <span className="font-mono">{formatTime(e.timestamp)}</span>
                        <span className="text-fg/20">·</span>
                        <span className="font-mono">#{e.id}</span>
                      </span>

                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void handleCopyDetail(e);
                          }}
                          className={cn(
                            'flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition',
                            size.meta,
                            detailCopied
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'hover:bg-fg/8 text-fg/60 hover:text-fg/85',
                          )}
                          title="Copy event"
                        >
                          {detailCopied ? <Check size={12} /> : <Copy size={12} />}
                          {detailCopied ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setModalEventId(e.id);
                          }}
                          className={cn(
                            'hover:bg-fg/8 text-fg/60 hover:text-fg/85 flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition',
                            size.meta,
                          )}
                          title="Open full view"
                        >
                          <Maximize2 size={12} />
                          Full view
                        </button>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedId(null);
                          }}
                          className="hover:bg-fg/8 text-fg/40 hover:text-fg/70 rounded-md p-1.5 transition"
                          title="Close (Esc)"
                          aria-label="Close"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        </button>
      </div>
    );
  };

  const renderEventList = () => (
    <div ref={listScrollRef} className="overlay-scroll min-h-0 flex-1 overflow-auto">
      {loading && events.length === 0 && <ListSkeleton isInline={isInline} padX={size.padX} />}
      {!loading && filteredEvents.length === 0 && (
        <div className="text-fg/40 flex flex-col items-center gap-2.5 px-6 py-20">
          {search.trim() ? (
            <>
              <div className="bg-fg/5 flex h-10 w-10 items-center justify-center rounded-full">
                <Search size={18} className="text-fg/35" />
              </div>
              <span className={cn('text-fg/60 font-semibold', size.title)}>No matches</span>
              <span className={cn('text-fg/40', size.meta)}>
                for “{search.trim().slice(0, 28)}”
              </span>
              <button
                onClick={() => setSearch('')}
                className={cn(
                  'text-accent hover:bg-accent/10 mt-1 rounded px-2 py-1 font-medium transition',
                  size.meta,
                )}
              >
                Clear search
              </button>
            </>
          ) : activeFilterCount > 0 ? (
            <>
              <div className="bg-fg/5 flex h-10 w-10 items-center justify-center rounded-full">
                <FilterX size={18} className="text-fg/35" />
              </div>
              <span className={cn('text-fg/60 font-semibold', size.title)}>Filtered out</span>
              <span className={cn('text-fg/40 text-center', size.meta)}>
                No events match current filters
              </span>
              <button
                onClick={clearFilters}
                className={cn(
                  'text-accent hover:bg-accent/10 mt-1 rounded px-2 py-1 font-medium transition',
                  size.meta,
                )}
              >
                Reset filters
              </button>
            </>
          ) : (
            <>
              <div className="bg-accent/10 flex h-10 w-10 items-center justify-center rounded-full">
                <Activity size={18} className="text-accent" />
              </div>
              <span className={cn('text-fg/60 font-semibold', size.title)}>Nothing yet</span>
              <span className={cn('text-fg/40 max-w-[240px] text-center', size.meta)}>
                Start a service or commit — events will land here in real time.
              </span>
            </>
          )}
        </div>
      )}
      {grouped.map((group) => {
        const errorsInGroup = group.events.filter(
          (e) => e.event_type === 'log_error' || e.event_type === 'service_crashed',
        ).length;
        return (
          <div key={group.bucket}>
            <div
              className={cn(
                'bg-surface/92 border-border/30 sticky top-0 z-10 flex items-center gap-2 border-b backdrop-blur-sm',
                size.padX,
                'py-2',
              )}
            >
              <span
                className={cn('text-fg/65 font-semibold tracking-[0.12em] uppercase', size.meta)}
              >
                {group.label}
              </span>
              <span className={cn('text-fg/35 tabular-nums', size.micro)}>
                · {group.events.length} event{group.events.length === 1 ? '' : 's'}
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
            <div>
              {group.events.map((e, i) =>
                renderEventRow(e, i === 0, i === group.events.length - 1),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderModal = () => {
    if (!modalEvent) return null;
    const cfg = eventConfig[modalEvent.event_type] ?? defaultConfig;
    const firstBreak = modalEvent.description.indexOf('\n');
    const heading =
      firstBreak === -1
        ? modalEvent.description
        : modalEvent.description.slice(0, firstBreak).trim();
    const body = firstBreak === -1 ? '' : modalEvent.description.slice(firstBreak + 1).trim();

    const metaLine = [
      formatTime(modalEvent.timestamp),
      `#${modalEvent.id}`,
      modalEvent.service_name,
      modalEvent.event_type,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <Dialog
        title={cfg.label}
        subtitle={metaLine}
        onClose={() => setModalEventId(null)}
        size="lg"
        footer={
          <>
            <button
              onClick={() => setModalEventId(null)}
              className="text-fg/60 hover:text-fg/90 hover:bg-fg/8 rounded-md px-3 py-1.5 text-[12px] font-medium transition"
            >
              Close
            </button>
            <button
              onClick={() => void handleCopyDetail(modalEvent)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition',
                detailCopied
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-accent/10 text-accent hover:bg-accent/15',
              )}
            >
              {detailCopied ? <Check size={13} /> : <Copy size={13} />}
              {detailCopied ? 'Copied' : 'Copy'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <EventBadge cfg={cfg} size="text-[10px]" />
            {modalEvent.service_name && (
              <span className="text-fg/50 text-[12px] font-medium" title={modalEvent.service_name}>
                {modalEvent.service_name}
              </span>
            )}
            <span className="text-fg/40 ml-auto font-mono text-[11px] tabular-nums">
              {formatTime(modalEvent.timestamp)}
            </span>
          </div>

          <h3 className="text-fg text-[15px] leading-snug font-semibold wrap-break-word">
            {heading}
          </h3>

          {body && (
            <pre className="overlay-scroll text-fg/75 border-border/40 bg-fg/3 max-h-[55vh] overflow-auto rounded-md border px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
              {body}
            </pre>
          )}
        </div>
      </Dialog>
    );
  };

  const renderFooter = () => (
    <div className={cn('border-border/40 border-t py-2', size.padX)}>
      <div className={cn('text-fg/40 flex items-center justify-between', size.micro)}>
        <span className="tabular-nums">
          {filteredEvents.length === events.length
            ? `${events.length} event${events.length === 1 ? '' : 's'}`
            : `${filteredEvents.length} of ${events.length}`}
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

  // ─────────────── INLINE VARIANT ───────────────
  if (isInline) {
    const isPanelVisible = !collapsed || hoverOpen;
    const isOverlay = collapsed && hoverOpen;

    return (
      <div
        className={cn(
          // `min-h-0` + `h-full` keeps the absolute overlay strictly bounded
          // to the main area so it never encroaches on the status bar.
          'relative flex h-full min-h-0 shrink-0 self-stretch',
          collapsed ? 'w-11' : 'w-[420px]',
        )}
        onMouseEnter={() => {
          if (collapsed) scheduleHoverOpen();
        }}
        onMouseLeave={() => {
          if (collapsed) scheduleHoverClose();
        }}
      >
        {/* Collapsed rail — 44px anchor with at-a-glance badges */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            onFocus={scheduleHoverOpen}
            className="bg-surface border-border/40 hover:bg-fg/3 group flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l pt-3.5 transition"
            title="Click to pin · hover to peek"
            aria-label="Expand activity timeline"
          >
            <div className="bg-accent/10 text-accent group-hover:bg-accent/20 flex h-7 w-7 items-center justify-center rounded-md transition">
              <Activity className="h-3.5 w-3.5" />
            </div>
            {summary && (
              <div className="flex flex-col items-center gap-1.5">
                {summary.commits > 0 && (
                  <span
                    className="text-[10.5px] font-semibold text-violet-400 tabular-nums"
                    title={`${summary.commits} commit${summary.commits === 1 ? '' : 's'} today`}
                  >
                    {summary.commits}
                  </span>
                )}
                {summary.services_started > 0 && (
                  <span
                    className="text-[10.5px] font-semibold text-emerald-400 tabular-nums"
                    title={`${summary.services_started} start${
                      summary.services_started === 1 ? '' : 's'
                    } today`}
                  >
                    {summary.services_started}
                  </span>
                )}
                {summary.errors > 0 && (
                  <span
                    className="relative text-[10.5px] font-semibold text-rose-400 tabular-nums"
                    title={`${summary.errors} error${summary.errors === 1 ? '' : 's'} today`}
                  >
                    {summary.errors}
                    <span className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                  </span>
                )}
              </div>
            )}
            <PanelRightOpen className="text-fg/25 group-hover:text-fg/55 mt-auto mb-3 h-3.5 w-3.5 transition" />
          </button>
        )}

        {isPanelVisible && (
          <div
            className={cn(
              'bg-surface border-border/60 flex min-h-0 w-[420px] flex-col border-l',
              isOverlay
                ? // absolute overlay — strictly inside the wrapper so status bar
                  // is never covered.
                  'animate-in slide-in-from-right absolute top-0 right-0 bottom-0 z-40 max-h-full shadow-2xl duration-150'
                : 'h-full flex-1',
            )}
            onMouseEnter={() => {
              if (collapsed) {
                clearHoverTimer();
                setHoverOpen(true);
              }
            }}
          >
            {/* Header */}
            <div
              className={cn(
                'border-border/40 flex items-center gap-2 border-b',
                size.padX,
                size.headerPY,
              )}
            >
              <div
                className={cn(
                  'bg-accent/10 text-accent flex items-center justify-center rounded-md',
                  size.iconWrap,
                )}
              >
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span className={cn('text-fg font-semibold tracking-tight', size.title)}>
                Activity
              </span>
              {isOverlay && (
                <span className="bg-fg/6 text-fg/55 rounded px-1.5 py-0.5 text-[9.5px] font-medium tracking-wider uppercase">
                  Peek
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => void handleExportStandup()}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
                    size.meta,
                    standupCopied
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'hover:bg-fg/8 text-fg/55 hover:text-fg/85',
                  )}
                  title="Copy last 24h as standup notes"
                >
                  {standupCopied ? <Check size={12} /> : <Copy size={12} />}
                  {standupCopied ? 'Copied' : 'Standup'}
                </button>
                <button
                  onClick={() => void refresh()}
                  className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition disabled:opacity-50"
                  title="Refresh now"
                  disabled={loading}
                  aria-label="Refresh"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
                {isOverlay ? (
                  <button
                    onClick={() => setCollapsed(false)}
                    className="hover:bg-accent/10 text-fg/50 hover:text-accent rounded-md p-1.5 transition"
                    title="Pin open"
                    aria-label="Pin open"
                  >
                    <Pin size={13} />
                  </button>
                ) : (
                  <button
                    onClick={() => setCollapsed(true)}
                    className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition"
                    title="Collapse (hover rail to peek)"
                    aria-label="Collapse timeline"
                  >
                    <PanelRightClose size={13} />
                  </button>
                )}
              </div>
            </div>

            {renderSummaryStrip()}
            {renderWeeklySparkline()}
            {renderFilters()}
            {renderEventList()}
            {renderFooter()}
          </div>
        )}
        {renderModal()}
      </div>
    );
  }

  // ─────────────── OVERLAY VARIANT (modal from right edge) ───────────────
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close timeline"
      />
      <div className="bg-surface border-border animate-in slide-in-from-right relative flex h-full w-[680px] flex-col shadow-2xl duration-300">
        <div
          className={cn(
            'border-border/60 flex items-center gap-2.5 border-b',
            size.padX,
            size.headerPY,
          )}
        >
          <div
            className={cn(
              'bg-accent/10 flex items-center justify-center rounded-md',
              size.iconWrap,
            )}
          >
            <Activity className="text-accent h-4 w-4" />
          </div>
          <h2 className={cn('text-fg font-semibold tracking-tight', size.title)}>Activity</h2>
          <span className={cn('text-fg/40 tabular-nums', size.meta)}>{events.length} total</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => void handleExportStandup()}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition',
                size.meta,
                standupCopied
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'hover:bg-fg/8 text-fg/55 hover:text-fg/85',
              )}
              title="Copy standup summary"
            >
              {standupCopied ? <Check size={13} /> : <Copy size={13} />}
              {standupCopied ? 'Copied' : 'Standup'}
            </button>
            <button
              onClick={() => void refresh()}
              className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition"
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="hover:bg-fg/8 text-fg/50 hover:text-fg/80 rounded-md p-1.5 transition"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {renderSummaryStrip()}
        {renderWeeklySparkline()}
        {renderFilters()}
        {renderEventList()}
        {renderFooter()}
      </div>
      {renderModal()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Small presentational subcomponents
// ─────────────────────────────────────────────────────────────────────────
function SummaryStat({
  tone,
  count,
  label,
  size,
}: {
  tone: 'emerald' | 'violet' | 'rose';
  count: number;
  label: string;
  size: string;
}) {
  const tones: Record<typeof tone, { dot: string; text: string }> = {
    emerald: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
    violet: { dot: 'bg-violet-400', text: 'text-violet-400' },
    rose: { dot: 'bg-rose-400', text: 'text-rose-400' },
  };
  return (
    <span
      className={cn('flex items-center gap-1.5 font-medium tabular-nums', size, tones[tone].text)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tones[tone].dot)} />
      <span className="text-fg/85">{count}</span>
      <span className="text-fg/45">{label}</span>
    </span>
  );
}

/**
 * Badge for the event type — shadcn-style pill with bg tint + colored label.
 * Prominent primary identifier for each row.
 */
function EventBadge({
  cfg,
  size,
}: {
  cfg: { bg: string; color: string; label: string };
  size: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-semibold tracking-wider uppercase',
        size,
        cfg.bg,
        cfg.color,
      )}
    >
      {cfg.label}
    </span>
  );
}

function ListSkeleton({ isInline, padX }: { isInline: boolean; padX: string }) {
  void isInline;
  return (
    <div className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={cn('border-border/20 flex items-start gap-3 border-b py-3', padX)}>
          <div className="bg-fg/5 mt-0.5 h-5 w-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="bg-fg/5 h-3 w-16 rounded" />
              <div className="bg-fg/5 h-3 w-24 rounded" />
              <div className="bg-fg/5 ml-auto h-3 w-10 rounded" />
            </div>
            <div className="bg-fg/5 h-2.5 rounded" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
