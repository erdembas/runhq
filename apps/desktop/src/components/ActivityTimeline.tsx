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
import { makeAnsiConverter, renderAnsiToHtml } from '@/lib/ansi';
import { useAppStore, logKey } from '@/store/useAppStore';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { TimelineEvent, DailySummary, LogLine } from '@/types';
import { Select } from './ui/Select';
import { Dialog } from './ui/Dialog';

/** Unified shape for console-rendering — lets ConsoleOutput draw the same
 *  block whether the lines came from the live in-memory log buffer (current
 *  session, full stdout+stderr) or from DB-persisted `log_error` /
 *  `log_warning` rows (historical runs). Severity drives the gutter color;
 *  the ANSI renderer handles the text. */
interface ConsoleLine {
  /** Stable key for React — `live-<seq>` or `db-<eventId>`. */
  key: string;
  ts_ms: number;
  text: string;
  severity: 'error' | 'warn' | 'info' | 'system';
}

/** One tab in the ConsoleOutput block — isolates a single command's transcript
 *  so 4 concurrently-spawned processes don't end up interleaved in one
 *  chronological blob (useless for debugging "which of the 4 backends logged
 *  this"). Each section carries its own severity counts so the tab header
 *  can surface "2 errors" / "1 warn" chips without re-scanning the lines at
 *  render time. */
interface ConsoleSection {
  /** Stable tab key: `cmd::<name>` for live data, `all` for legacy DB fallback
   *  (log_error/log_warning rows aren't tagged with a cmd_name). */
  key: string;
  /** Display label — typically the command name; `All` for the DB-only
   *  fallback when cmd-level splitting is not available. */
  label: string;
  lines: ConsoleLine[];
  errors: number;
  warnings: number;
}

/** Heuristic severity for a live log line. Stream alone isn't enough — lots
 *  of dev tools emit non-error output on stderr (Vite progress, pnpm chatter,
 *  yarn "Port … in use" probes) — so we also scan for error/warn keywords.
 *  Matches the same filter App.tsx uses for the DB recorder, keeping the two
 *  code paths in agreement about what counts as "an error line". */
function severityOfLive(line: LogLine): ConsoleLine['severity'] {
  if (line.stream === 'system') return 'system';
  const t = line.text.toLowerCase();
  if (t.includes('error') || t.includes('fatal') || t.includes('panic')) return 'error';
  if (t.includes('warn')) return 'warn';
  return 'info';
}

function toConsoleLineFromLive(line: LogLine): ConsoleLine {
  return {
    key: `live-${line.seq}`,
    ts_ms: line.ts_ms,
    text: line.text,
    severity: severityOfLive(line),
  };
}

function toConsoleLineFromDb(child: TimelineEvent): ConsoleLine {
  const severity: ConsoleLine['severity'] =
    child.event_type === 'log_error'
      ? 'error'
      : child.event_type === 'log_warning'
        ? 'warn'
        : 'info';
  return {
    key: `db-${child.id}`,
    ts_ms: new Date(child.timestamp).getTime(),
    text: child.description,
    severity,
  };
}

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

// ─────────────── Width / resize constants ───────────────
// Mirrors SidebarRail's model so both chrome panels behave identically:
// the user drags an edge gutter, we clamp to [MIN, MAX], and persist to
// localStorage so the next session remembers the exact width (not some
// rounded "small/medium/large" preset).
//
// MIN is 400 — below that the header action cluster (Standup + Refresh +
// Pin) starts chewing into the title and the filter pill row loses too
// many visible pills before the user has to scroll. MAX is 720 which
// still leaves room for the main log panel on a 1440px screen; going
// wider turns the activity bar into a second primary column, which is
// not what this panel is for.
const TIMELINE_COLLAPSED_W = 44;
const TIMELINE_MIN_W = 400;
const TIMELINE_MAX_W = 600;
const TIMELINE_DEFAULT_W = 420;
const TIMELINE_WIDTH_KEY = 'runhq.timeline.width.v1';

function loadTimelineWidth(): number {
  if (typeof window === 'undefined') return TIMELINE_DEFAULT_W;
  try {
    const raw = window.localStorage.getItem(TIMELINE_WIDTH_KEY);
    if (raw == null) return TIMELINE_DEFAULT_W;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return TIMELINE_DEFAULT_W;
    // Clamp on read too — if a previous build used a different range, we
    // don't want a stuck-off-screen panel on upgrade.
    return Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, n));
  } catch {
    return TIMELINE_DEFAULT_W;
  }
}

function saveTimelineWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMELINE_WIDTH_KEY, String(Math.round(width)));
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
  const [standupCopied, setStandupCopied] = useState(false);
  const [detailCopied, setDetailCopied] = useState(false);
  const [collapsed, setCollapsedState] = useState<boolean>(() => loadTimelineCollapsed());
  const [hoverOpen, setHoverOpen] = useState(false);
  const [width, setWidth] = useState<number>(() => loadTimelineWidth());

  // ─────────────── Persistence of pin/collapse state ───────────────
  // Single source of truth: whenever `collapsed` flips, mirror it to
  // localStorage. This covers every code path that might mutate it
  // (pin button, collapse button, keyboard shortcuts, hydration) without
  // relying on every caller to remember to persist.
  useEffect(() => {
    saveTimelineCollapsed(collapsed);
  }, [collapsed]);

  // Persist width too — only the final resting value, not every frame of
  // the drag. `setWidth` already runs on every pointermove but localStorage
  // is cheap enough that batching via rAF would be premature optimisation
  // here; the delta is ~60 writes/sec for a one-second drag.
  useEffect(() => {
    saveTimelineWidth(width);
  }, [width]);

  // Cross-tab / cross-window sync — if another Runhq window toggles the
  // pin state or resizes the bar, reflect it here too. Harmless no-op in
  // single-window usage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === TIMELINE_COLLAPSED_KEY) {
        setCollapsedState(e.newValue === '1');
        return;
      }
      if (e.key === TIMELINE_WIDTH_KEY && e.newValue != null) {
        const n = Number.parseInt(e.newValue, 10);
        if (Number.isFinite(n)) {
          setWidth(Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, n)));
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ─────────────── Resize drag (left-edge gutter) ───────────────
  // The activity bar lives flush against the right window edge, so the
  // user grabs its LEFT edge to resize — dragging leftward = grow wider,
  // rightward = shrink. This is the inverse of SidebarRail (which grabs
  // its right edge). Pointer capture keeps the drag tracking even when
  // the cursor temporarily leaves the 6px handle, so fast drags don't
  // "drop" mid-motion.
  const resizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizing.current = true;
      resizeStartX.current = e.clientX;
      resizeStartW.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    // Inverted: dragging left (smaller clientX) should *grow* the panel
    // because the panel's left edge is moving further from the window's
    // right edge.
    const delta = resizeStartX.current - e.clientX;
    const next = resizeStartW.current + delta;
    setWidth(Math.max(TIMELINE_MIN_W, Math.min(TIMELINE_MAX_W, next)));
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    resizing.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer might already be released (e.g. pointercancel); non-fatal.
    }
  }, []);
  const [now, setNow] = useState(() => Date.now());

  // ─────────────── Live log buffer subscription ───────────────
  // The DB only persists keyword-matched stderr (log_error / log_warning),
  // so "quiet" runs — a successful `yarn dev` that just prints "ready in
  // 170 ms" — have NO child rows to show under their Started event. We
  // supplement that by reading the in-memory log buffer (same data the
  // LogPanel shows) and slicing it to the lifecycle event's time window.
  // For current-session runs this is strictly richer than the DB: every
  // stdout+stderr+system line ever emitted (up to a 5k cap) is available.
  // For pre-restart/historical runs the buffer is empty — we fall back to
  // the DB children so the modal still has something meaningful to show.
  const logsBySvc = useAppStore((s) => s.logs);
  const services = useAppStore((s) => s.services);

  // ─────────────── ANSI → HTML converter (theme-aware) ───────────────
  // Child log lines (log_error / log_warning) stored in the DB still carry
  // their raw ANSI escape codes from the process's stderr. Rendering them
  // through the same converter LogPanel uses means the per-event "console
  // output" block at the bottom of an expanded lifecycle row looks exactly
  // like the live terminal at the bottom of the screen — same palette,
  // same colors, no jarring style shift between the two views.
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  const ansi = useMemo(() => makeAnsiConverter(isDark), [isDark]);

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

  // ─────────────── Event bucket grouping (parent ↔ child) ───────────────
  // `run_id` in our schema is now a *per-lifecycle-event* bucket id (see
  // App.tsx): each `started` / `stopped` / `crashed` row mints its own id,
  // and any `log_error` / `log_warning` / `file_changed` that arrives while
  // that bucket is active stamps itself with that id. So Start owns the
  // run's logs, Stop owns whatever trailing noise arrives after it, etc.
  //
  // We hide child events from the main feed and render them as an inline
  // console-output block under their owning lifecycle row when expanded.
  // (Legacy rows written before this model shared a run_id across started +
  // stopped — `childrenByRun` still works there; the children just surface
  // under whichever lifecycle row was kept in the current view.)
  //
  // Grouping is bypassed when the user filters to a child type (Errors,
  // Warns, Files) — they want the flat list, not a single parent row.
  const { visibleEvents, childrenByRun } = useMemo(() => {
    const CHILD_TYPES: TimelineEvent['event_type'][] = ['log_error', 'log_warning', 'file_changed'];
    const LIFECYCLE_TYPES: TimelineEvent['event_type'][] = [
      'service_started',
      'service_stopped',
      'service_crashed',
    ];
    const empty = new Map<string, TimelineEvent[]>();
    if (filterType && CHILD_TYPES.includes(filterType as TimelineEvent['event_type'])) {
      return { visibleEvents: filteredEvents, childrenByRun: empty };
    }
    // Only roll children up into a run that actually HAS a lifecycle event
    // in the current view. Otherwise an orphan error would vanish (hidden
    // under a parent we'd never render).
    const runsWithLifecycle = new Set<string>();
    for (const e of filteredEvents) {
      if (e.run_id && LIFECYCLE_TYPES.includes(e.event_type)) {
        runsWithLifecycle.add(e.run_id);
      }
    }
    const children = new Map<string, TimelineEvent[]>();
    const hidden = new Set<number>();
    for (const e of filteredEvents) {
      if (!e.run_id) continue;
      if (!CHILD_TYPES.includes(e.event_type)) continue;
      if (!runsWithLifecycle.has(e.run_id)) continue;
      const list = children.get(e.run_id);
      if (list) list.push(e);
      else children.set(e.run_id, [e]);
      hidden.add(e.id);
    }
    return {
      visibleEvents: filteredEvents.filter((e) => !hidden.has(e.id)),
      childrenByRun: children,
    };
  }, [filteredEvents, filterType]);

  const grouped = useMemo(() => {
    const groups: Array<{ bucket: string; label: string; events: TimelineEvent[] }> = [];
    let currentBucket = '';
    for (const e of visibleEvents) {
      const b = dateBucket(e.timestamp);
      if (b !== currentBucket) {
        currentBucket = b;
        groups.push({ bucket: b, label: formatDateHeader(e.timestamp), events: [] });
      }
      groups[groups.length - 1]?.events.push(e);
    }
    return groups;
  }, [visibleEvents]);

  // ─────────────── Live console output per event, split by command ───────────────
  // Deterministic attribution by `run_id`, grouped by `cmd_name`.
  //
  // Both `LogLine` and the owning `service_started` row carry the same
  // `run_id` — minted in the Rust supervisor BEFORE the child is spawned,
  // stamped on every line the supervisor emits (prompt echo, pre-command
  // banners, stdout/stderr, the `[exited]` closer), and surfaced on the
  // `ServiceStatus` that produces the Started lifecycle event. Matching
  // `line.run_id === event.run_id` is therefore a single lookup with zero
  // dependence on IPC ordering or wall-clock jitter between `emit_log`
  // and `emit_status`.
  //
  // Within each event, lines are kept bucketed by the command that
  // produced them (we know the cmd_name from the `logsBySvc` key that
  // held the line). This lets the UI render one tab per command inside
  // a single lifecycle event — critical for multi-command services like
  // a 4-process `dotnet run` stack, where merging all output into one
  // chronological blob destroys the signal about *which* process logged
  // what.
  //
  // A legacy time-window fallback stays in place ONLY for events that
  // have no `run_id` — i.e. rows recorded by a previous app version
  // (before run-id propagation) or log lines from a still-buffered
  // pre-upgrade run. New rows will never fall into that branch.
  const liveLinesByEventId = useMemo(() => {
    const LIFECYCLE_TYPES: TimelineEvent['event_type'][] = [
      'service_started',
      'service_stopped',
      'service_crashed',
    ];
    const bySvc: Record<string, TimelineEvent[]> = {};
    for (const e of events) {
      if (!e.service_id) continue;
      if (!LIFECYCLE_TYPES.includes(e.event_type)) continue;
      (bySvc[e.service_id] ||= []).push(e);
    }
    // eventId → (cmdName → lines). Using a nested map (rather than flat
    // `cmd::name` keys) keeps the intent explicit at the call site and
    // avoids accidental key collisions if a cmd name ever contained `::`.
    const result = new Map<number, Map<string, LogLine[]>>();
    for (const [serviceId, lifecycleEvents] of Object.entries(bySvc)) {
      const svc = services.find((s) => s.id === serviceId);
      if (!svc) continue;

      // Primary path: for each cmd buffer, bucket ITS lines by run_id.
      // Keeps (run_id, cmd_name) as a composite key without ever
      // concatenating; when we later assemble the event's sections, we
      // walk the cmd buffers in the service's declared order so tabs
      // preserve the user's configured ordering.
      type CmdBuckets = {
        byRun: Map<string, LogLine[]>;
        orphans: LogLine[];
      };
      const perCmd = new Map<string, CmdBuckets>();
      let hasAnyLine = false;
      let hasAnyOrphan = false;
      for (const cmd of svc.cmds) {
        const buf = logsBySvc[logKey(serviceId, cmd.name)];
        if (!buf || buf.lines.length === 0) continue;
        hasAnyLine = true;
        const buckets: CmdBuckets = { byRun: new Map(), orphans: [] };
        for (const l of buf.lines) {
          if (l.run_id) {
            const list = buckets.byRun.get(l.run_id);
            if (list) list.push(l);
            else buckets.byRun.set(l.run_id, [l]);
          } else {
            buckets.orphans.push(l);
            hasAnyOrphan = true;
          }
        }
        for (const list of buckets.byRun.values()) {
          list.sort((a, b) => a.ts_ms - b.ts_ms || a.seq - b.seq);
        }
        buckets.orphans.sort((a, b) => a.ts_ms - b.ts_ms || a.seq - b.seq);
        perCmd.set(cmd.name, buckets);
      }
      if (!hasAnyLine) continue;

      for (const ev of lifecycleEvents) {
        if (!ev.run_id) continue;
        const perCmdForEvent = new Map<string, LogLine[]>();
        for (const cmd of svc.cmds) {
          const buckets = perCmd.get(cmd.name);
          if (!buckets) continue;
          const lines = buckets.byRun.get(ev.run_id);
          if (lines && lines.length > 0) perCmdForEvent.set(cmd.name, lines);
        }
        if (perCmdForEvent.size > 0) result.set(ev.id, perCmdForEvent);
      }

      // ── Fallback: time-window attribution for untagged data ──
      // Only engage when we actually have untagged lines AND lifecycle
      // events without a run_id. Skips the whole branch for freshly
      // stamped runs (the common case) so we pay no extra cost there.
      const legacyEvents = lifecycleEvents.filter((e) => !e.run_id);
      if (legacyEvents.length === 0 || !hasAnyOrphan) continue;

      const sortedLifecycle = [...lifecycleEvents].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      for (let i = 0; i < sortedLifecycle.length; i++) {
        const ev = sortedLifecycle[i]!;
        if (ev.run_id) continue;
        const startMs = new Date(ev.timestamp).getTime();
        const endMs =
          i + 1 < sortedLifecycle.length
            ? new Date(sortedLifecycle[i + 1]!.timestamp).getTime()
            : Date.now() + 1000;
        const perCmdForEvent = new Map<string, LogLine[]>();
        for (const cmd of svc.cmds) {
          const buckets = perCmd.get(cmd.name);
          if (!buckets || buckets.orphans.length === 0) continue;
          const windowLines = buckets.orphans.filter((l) => l.ts_ms >= startMs && l.ts_ms < endMs);
          if (windowLines.length > 0) perCmdForEvent.set(cmd.name, windowLines);
        }
        if (perCmdForEvent.size > 0) result.set(ev.id, perCmdForEvent);
      }
    }
    return result;
  }, [events, logsBySvc, services]);

  // Assemble per-command sections for a lifecycle event.
  //
  // Live buffers (comprehensive, stream-complete) take precedence — we
  // emit one tab per command that actually produced output during this
  // run. The command order mirrors the service definition so the tabs
  // don't reshuffle mid-session when a later command happens to log
  // first. When the live buffer is empty (historical run whose in-memory
  // transcript was flushed on app restart), we fall back to DB-persisted
  // `log_error`/`log_warning` rows rolled up under one "All" tab — the
  // DB schema doesn't carry `cmd_name` on those rows, so cmd-level
  // splitting is not available for legacy data.
  const consoleSectionsFor = useCallback(
    (e: TimelineEvent): ConsoleSection[] => {
      const live = liveLinesByEventId.get(e.id);
      if (live && live.size > 0) {
        const sections: ConsoleSection[] = [];
        // Honor the service's declared command order so tabs are stable
        // across sessions regardless of which cmd happened to log first.
        const svc = e.service_id ? services.find((s) => s.id === e.service_id) : undefined;
        const orderedNames = svc ? svc.cmds.map((c) => c.name) : [...live.keys()];
        for (const name of orderedNames) {
          const lines = live.get(name);
          if (!lines || lines.length === 0) continue;
          const consoleLines = lines.map(toConsoleLineFromLive);
          sections.push({
            key: `cmd::${name}`,
            label: name,
            lines: consoleLines,
            errors: consoleLines.filter((c) => c.severity === 'error').length,
            warnings: consoleLines.filter((c) => c.severity === 'warn').length,
          });
        }
        if (sections.length > 0) return sections;
      }
      const dbChildren = e.run_id ? childrenByRun.get(e.run_id) : undefined;
      if (!dbChildren || dbChildren.length === 0) return [];
      const consoleLines = dbChildren.map(toConsoleLineFromDb);
      return [
        {
          key: 'all',
          label: 'All',
          lines: consoleLines,
          errors: consoleLines.filter((c) => c.severity === 'error').length,
          warnings: consoleLines.filter((c) => c.severity === 'warn').length,
        },
      ];
    },
    [liveLinesByEventId, childrenByRun, services],
  );

  // `all` is the logical opposite of a filter (= show everything), so it
  // must NOT contribute to the active-filter count — otherwise picking
  // "All" flips the empty state from "Nothing yet" to "Filtered out" and
  // misleads the user into thinking something is hiding their events.
  const activeFilterCount =
    (filterType ? 1 : 0) +
    (filterProject ? 1 : 0) +
    (timeRange !== '24h' && timeRange !== 'all' ? 1 : 0) +
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
    // Always visible — the 7-day rhythm is a low-cost, high-value glance
    // (spot the errors spike, see which days were quiet) that used to be
    // tucked behind a toggle nobody ever flipped. If there's literally no
    // data yet we just skip rendering rather than show an empty frame.
    if (!weeklySummary || weeklySummary.length === 0) return null;
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

      {/* Type pills — horizontal scroll.
          Extra right padding (`pr-6`) keeps the last pill from hugging the
          panel edge as the user scrolls, and the bottom padding gives the
          overflow scrollbar room to sit without clipping the pill baseline. */}
      <div className="-mx-2 flex items-center gap-1 overflow-x-auto px-2 pr-6 pb-1.5">
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

      {/* Project + time range — `Week` toggle removed; weekly sparkline is
          now always on (see renderWeeklySparkline). */}
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

    // ─── Per-command console sections for this lifecycle event ───
    // `consoleSectionsFor` prefers the live in-memory buffers (full
    // stdout+stderr of the running session, split per command) and
    // falls back to a single DB-backed section when the buffer is empty
    // (pre-restart / historical data). Stats drive the little count
    // chip in the title row — computed across ALL sections so the
    // number reflects the whole lifecycle event, not just whichever
    // tab happens to be active.
    const consoleSections = consoleSectionsFor(e);
    const consoleLineCount = consoleSections.reduce((n, s) => n + s.lines.length, 0);
    const childStats =
      consoleLineCount > 0
        ? {
            total: consoleLineCount,
            errors: consoleSections.reduce((n, s) => n + s.errors, 0),
            warnings: consoleSections.reduce((n, s) => n + s.warnings, 0),
            files: 0,
          }
        : null;

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
              {/* Rolled-up child count — tells the user, without expanding,
                  how noisy this run was. Errors win the slot when present
                  because that's the signal they actually care about. */}
              {childStats && childStats.total > 0 && (
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
                    size.micro,
                    childStats.errors > 0
                      ? 'bg-rose-500/10 text-rose-400'
                      : childStats.warnings > 0
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-fg/5 text-fg/55',
                  )}
                  title={[
                    childStats.errors > 0 &&
                      `${childStats.errors} error${childStats.errors === 1 ? '' : 's'}`,
                    childStats.warnings > 0 &&
                      `${childStats.warnings} warning${childStats.warnings === 1 ? '' : 's'}`,
                    childStats.files > 0 &&
                      `${childStats.files} file change${childStats.files === 1 ? '' : 's'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {childStats.errors > 0 ? (
                    <XCircle size={10} />
                  ) : childStats.warnings > 0 ? (
                    <AlertTriangle size={10} />
                  ) : (
                    <FileEdit size={10} />
                  )}
                  {childStats.total}
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

                    {/* Per-event, per-command console output. For multi-
                        command services this renders as tabs (one per
                        command) so you can isolate e.g. "platform-api"'s
                        transcript without the "console-api" logs bleeding
                        into the same scroll. Single-command services
                        collapse to a plain terminal block with no tab
                        row — same as before. */}
                    {consoleSections.length > 0 && (
                      <ConsoleOutput
                        sections={consoleSections}
                        ansi={ansi}
                        isDark={isDark}
                        microSize={size.micro}
                        metaSize={size.meta}
                      />
                    )}
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
        // Count errors including the ones we've rolled up as children of
        // lifecycle events in this group — otherwise the group header would
        // under-report the day's error count after collapsing. Guard with
        // a `seen` set so runs with multiple lifecycle rows in the group
        // (e.g. started + stopped) don't get their error count doubled.
        const seenRuns = new Set<string>();
        const errorsInGroup =
          group.events.filter(
            (e) => e.event_type === 'log_error' || e.event_type === 'service_crashed',
          ).length +
          group.events.reduce((n, e) => {
            if (!e.run_id || seenRuns.has(e.run_id)) return n;
            seenRuns.add(e.run_id);
            return (
              n +
              (childrenByRun.get(e.run_id)?.filter((c) => c.event_type === 'log_error').length ?? 0)
            );
          }, 0);
        return (
          <div key={group.bucket}>
            {/* Sticky date group header.
             *  - `z-20` has to beat the event row's dot (`z-10`) so the
             *    first row's lightning icon doesn't poke above the
             *    header as the list scrolls.
             *  - Solid `bg-surface` (not `/92` transparency) for the
             *    same reason: a half-transparent header let the dot
             *    and the git-history connector line bleed through it,
             *    breaking the illusion that the header is above the
             *    feed. */}
            <div
              className={cn(
                'bg-surface border-border/30 sticky top-0 z-20 flex items-center gap-2 border-b',
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

    // Same lookup path as the inline view — live buffer is the primary
    // source so the modal matches 1:1 with what the LogPanel shows for a
    // currently-running service. Falls back to DB children for pre-restart
    // runs where the buffer is empty.
    const modalConsoleSections = consoleSectionsFor(modalEvent);
    const modalConsoleLineCount = modalConsoleSections.reduce((n, s) => n + s.lines.length, 0);
    const modalChildStats =
      modalConsoleLineCount > 0
        ? {
            total: modalConsoleLineCount,
            errors: modalConsoleSections.reduce((n, s) => n + s.errors, 0),
            warnings: modalConsoleSections.reduce((n, s) => n + s.warnings, 0),
            files: 0,
          }
        : null;

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
            <pre className="overlay-scroll text-fg/75 border-border/40 bg-fg/3 max-h-[40vh] overflow-auto rounded-md border px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
              {body}
            </pre>
          )}

          {modalChildStats && (
            <ConsoleOutput
              sections={modalConsoleSections}
              ansi={ansi}
              isDark={isDark}
              microSize="text-[10.5px]"
              metaSize="text-[12px]"
              maxHeightClass="max-h-[45vh]"
            />
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
        )}
        // Width comes from state so the user can drag-resize like the
        // sidebar; collapsed state is a fixed 44px rail regardless of
        // the stored width so peek-hover always aligns to the edge.
        style={{ width: collapsed ? TIMELINE_COLLAPSED_W : width }}
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
              // `min-w-0` + `overflow-hidden` keep per-row overflow
              // (long event descriptions, the console block's wide
              // lines) strictly inside the panel — without it, the
              // ConsoleOutput's `w-max` rows would blow out the right
              // edge and eat the header's action buttons on narrow
              // widths.
              'bg-surface border-border/60 flex min-h-0 min-w-0 flex-col overflow-hidden border-l',
              isOverlay
                ? // absolute overlay — strictly inside the wrapper so status bar
                  // is never covered.
                  'animate-in slide-in-from-right absolute top-0 right-0 bottom-0 z-40 max-h-full shadow-2xl duration-150'
                : 'h-full flex-1',
            )}
            // Peek overlay uses the stored width directly (inline style)
            // because it's `absolute`, so flex-1 doesn't stretch it — it
            // would otherwise collapse to 0. Pinned-open mode inherits
            // from the wrapper via `flex-1` and needs no explicit width.
            style={isOverlay ? { width } : undefined}
            onMouseEnter={() => {
              if (collapsed) {
                clearHoverTimer();
                setHoverOpen(true);
              }
            }}
          >
            {/* Header — shrink-hardened so narrow windows never eat the
                action buttons. The title truncates first (it's the only
                element here that can afford to), the icon stays fixed
                size, and the action cluster keeps `shrink-0` so the
                Standup / Refresh / Pin buttons are always reachable. */}
            <div
              className={cn(
                'border-border/40 flex items-center gap-2 border-b',
                size.padX,
                size.headerPY,
              )}
            >
              <div
                className={cn(
                  'bg-accent/10 text-accent flex shrink-0 items-center justify-center rounded-md',
                  size.iconWrap,
                )}
              >
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span
                className={cn(
                  'text-fg min-w-0 flex-1 truncate font-semibold tracking-tight',
                  size.title,
                )}
              >
                Activity
              </span>
              {isOverlay && (
                <span className="bg-fg/6 text-fg/55 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium tracking-wider uppercase">
                  Peek
                </span>
              )}
              <div className="flex shrink-0 items-center gap-1">
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
        {/* Left-edge resize gutter. Mirrors SidebarRail's right-edge
            handle: an 8px hover zone wraps a 2px visible strip that
            highlights on hover/active. Only rendered in pinned-open
            mode — when collapsed there's nothing to resize (it's a
            44px rail), and in peek-overlay mode the panel is a
            transient hover state that shouldn't be drag-resized. */}
        {!collapsed && (
          <div
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="group absolute top-0 bottom-0 left-0 z-20 w-2 cursor-col-resize"
            aria-hidden
          >
            <div className="group-hover:bg-accent/30 group-active:bg-accent/50 absolute top-0 bottom-0 left-0 w-[2px] transition-colors" />
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

// ─────────────────────────────────────────────────────────────────────────
// ConsoleOutput — renders the per-command log sections of a lifecycle event
// as a dark, monospace "terminal" block with tabs for each command.
//
// Design notes:
// - One tab per command. A service that fans out 4 processes on start
//   gets 4 independent transcripts instead of one interleaved mess —
//   matches how a developer mentally models "process A's output" vs
//   "process B's output" when debugging. With a single command, the
//   tab row is hidden entirely so the chrome doesn't get in the way.
// - Default selected tab: the noisiest one with errors, else warnings,
//   else the one with the most lines. Picks up where the user's
//   attention would naturally land.
// - Lines come in DESC (newest first) from the DB query. We render them
//   in ASC order here because a terminal reads top-to-bottom,
//   oldest-to-newest. Stable tie-break on `key` keeps same-ms lines
//   deterministic across renders.
// - Severity chips (errors/warnings) appear both in the section header
//   and in each tab's label so you can tell where the noise is at a
//   glance without cycling through every tab.
// ─────────────────────────────────────────────────────────────────────────
function ConsoleOutput({
  sections,
  ansi,
  isDark,
  microSize,
  metaSize,
  maxHeightClass = 'max-h-80',
}: {
  sections: ConsoleSection[];
  ansi: ReturnType<typeof makeAnsiConverter>;
  isDark: boolean;
  microSize: string;
  metaSize: string;
  maxHeightClass?: string;
}) {
  // Aggregate stats for the block header — gives "how noisy was this run
  // overall" at a glance, independent of which tab happens to be active.
  const totals = useMemo(() => {
    let total = 0;
    let errors = 0;
    let warnings = 0;
    for (const s of sections) {
      total += s.lines.length;
      errors += s.errors;
      warnings += s.warnings;
    }
    return { total, errors, warnings };
  }, [sections]);

  // Default tab: prefer the loudest (errors > warnings > line count) so
  // the user lands on whichever process most likely explains why they
  // opened this event. Falls through to the first section if all are
  // equally quiet.
  const defaultKey = useMemo(() => {
    if (sections.length === 0) return '';
    const ranked = [...sections].sort((a, b) => {
      if (a.errors !== b.errors) return b.errors - a.errors;
      if (a.warnings !== b.warnings) return b.warnings - a.warnings;
      return b.lines.length - a.lines.length;
    });
    return ranked[0]!.key;
  }, [sections]);

  const [activeKey, setActiveKey] = useState<string>(defaultKey);

  // Keep the tab selection resilient to section churn: if the live
  // buffer of a still-running service adds/removes cmd tabs between
  // renders, or if a freshly-opened event mints a different `defaultKey`,
  // snap to the current default rather than leave `activeKey` pointing
  // at a vanished tab (which would render an empty body).
  useEffect(() => {
    if (sections.length === 0) return;
    if (!sections.some((s) => s.key === activeKey)) {
      setActiveKey(defaultKey);
    }
  }, [sections, activeKey, defaultKey]);

  const activeSection = sections.find((s) => s.key === activeKey) ?? sections[0];
  const ordered = useMemo(() => {
    if (!activeSection) return [] as ConsoleLine[];
    return [...activeSection.lines].sort((a, b) => {
      if (a.ts_ms !== b.ts_ms) return a.ts_ms - b.ts_ms;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }, [activeSection]);

  const hasTabs = sections.length > 1;

  return (
    <div className="border-border/30 mt-4 border-t pt-3">
      <div
        className={cn(
          'text-fg/45 mb-2 flex items-center gap-2 font-semibold tracking-[0.12em] uppercase',
          microSize,
        )}
      >
        <span>Console output</span>
        <span className="text-fg/25 tabular-nums">
          · {totals.total} line{totals.total === 1 ? '' : 's'}
        </span>
        {hasTabs && (
          <span className="text-fg/25 tabular-nums">
            · {sections.length} command{sections.length === 1 ? '' : 's'}
          </span>
        )}
        {totals.errors > 0 && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-rose-400 normal-case tabular-nums',
              'ml-auto',
            )}
          >
            <XCircle size={10} />
            {totals.errors}
          </span>
        )}
        {totals.warnings > 0 && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-400 normal-case tabular-nums',
              totals.errors === 0 && 'ml-auto',
            )}
          >
            <AlertTriangle size={10} />
            {totals.warnings}
          </span>
        )}
      </div>
      {hasTabs && (
        <div className="overlay-scroll -mx-0.5 mb-2 flex items-center gap-1 overflow-x-auto px-0.5 pb-1">
          {sections.map((s) => {
            const isActive = s.key === (activeSection?.key ?? '');
            return (
              <button
                key={s.key}
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setActiveKey(s.key);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono transition',
                  microSize,
                  isActive
                    ? 'border-accent/40 bg-accent/10 text-fg'
                    : 'border-border/40 text-fg/55 hover:border-border/70 hover:text-fg/85',
                )}
                title={`${s.label} · ${s.lines.length} line${s.lines.length === 1 ? '' : 's'}`}
              >
                <span className="truncate">{s.label}</span>
                <span className={cn('tabular-nums', isActive ? 'text-fg/55' : 'text-fg/35')}>
                  {s.lines.length}
                </span>
                {s.errors > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1 text-rose-400 tabular-nums">
                    <XCircle size={9} />
                    {s.errors}
                  </span>
                )}
                {s.errors === 0 && s.warnings > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1 text-amber-400 tabular-nums">
                    <AlertTriangle size={9} />
                    {s.warnings}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div
        className={cn(
          'overlay-scroll overflow-auto rounded-md border font-mono',
          maxHeightClass,
          isDark
            ? 'border-black/60 bg-[#1e1e1e] text-[#d4d4d4]'
            : 'border-slate-300 bg-white text-slate-800',
        )}
      >
        {ordered.length === 0 ? (
          <div className={cn('text-fg/35 px-3 py-4 text-center', metaSize)}>
            No console output captured.
          </div>
        ) : (
          <div className="py-1.5">
            {ordered.map((line) => (
              <ConsoleLineRow
                key={line.key}
                line={line}
                ansi={ansi}
                microSize={microSize}
                metaSize={metaSize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatConsoleTimeFromMs(tsMs: number): string {
  try {
    const d = new Date(tsMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return '';
  }
}

function ConsoleLineRow({
  line,
  ansi,
  microSize,
  metaSize,
}: {
  line: ConsoleLine;
  ansi: ReturnType<typeof makeAnsiConverter>;
  microSize: string;
  metaSize: string;
}) {
  // Pre-render once per line; memoized because the ANSI converter is
  // expensive to hit for every render of a scroll container.
  const html = useMemo(() => renderAnsiToHtml(ansi, line.text), [ansi, line.text]);
  const gutter =
    line.severity === 'error'
      ? 'border-l-2 border-rose-500/60'
      : line.severity === 'warn'
        ? 'border-l-2 border-amber-500/50'
        : line.severity === 'system'
          ? 'border-l-2 border-accent/50'
          : 'border-l-2 border-transparent';
  return (
    // `w-max min-w-full` + `whitespace-pre` = real-terminal behaviour:
    // long lines extend past the viewport and scroll horizontally via the
    // parent's `overflow-auto`, while short lines still stretch the hover
    // bg to full width so the gutter/highlight feels consistent. No
    // soft-wrapping means port-number columns, stack-trace indentation,
    // table output (cargo, pnpm, vite) all stay aligned instead of
    // folding into garbled multi-line blobs.
    <div
      className={cn(
        'flex w-max min-w-full items-start gap-2.5 px-3 py-0.5 leading-relaxed hover:bg-white/4',
        gutter,
      )}
    >
      <span
        className={cn('shrink-0 tabular-nums opacity-60 select-none', microSize)}
        title={new Date(line.ts_ms).toLocaleTimeString()}
      >
        {formatConsoleTimeFromMs(line.ts_ms)}
      </span>
      <span
        className={cn('shrink-0 whitespace-pre', metaSize)}
        // `ansi` is configured with escapeXML: true, so the raw text is
        // HTML-escaped before color spans are wrapped around it — safe to
        // drop into the DOM. If we didn't do this we'd have to either
        // parse the HTML manually (fragile — see LogPanel's URL linkifier
        // for an example of how nested spans break regex) or skip ANSI
        // colors altogether, both of which regress the rendering.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
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
