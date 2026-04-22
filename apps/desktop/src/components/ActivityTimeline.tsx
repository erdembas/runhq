import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ArrowRightCircle,
  XCircle,
  Terminal,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { TimelineEvent, DailySummary } from '@/types';

interface ActivityTimelineProps {
  onClose: () => void;
}

const eventConfig: Record<
  string,
  { icon: typeof Play; color: string; bg: string; ring: string; label: string }
> = {
  service_started: {
    icon: Play,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    ring: 'ring-emerald-500/30',
    label: 'Started',
  },
  service_stopped: {
    icon: Square,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    ring: 'ring-slate-500/20',
    label: 'Stopped',
  },
  service_crashed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    ring: 'ring-red-500/30',
    label: 'Crashed',
  },
  git_commit: {
    icon: GitCommitHorizontal,
    color: 'text-violet-400',
    bg: 'bg-violet-500/15',
    ring: 'ring-violet-500/30',
    label: 'Commit',
  },
  git_push: {
    icon: GitMerge,
    color: 'text-fuchsia-400',
    bg: 'bg-fuchsia-500/15',
    ring: 'ring-fuchsia-500/30',
    label: 'Push',
  },
  git_checkout: {
    icon: GitBranch,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    ring: 'ring-cyan-500/30',
    label: 'Checkout',
  },
  log_error: {
    icon: Bug,
    color: 'text-rose-400',
    bg: 'bg-rose-500/15',
    ring: 'ring-rose-500/30',
    label: 'Error',
  },
  log_warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    label: 'Warning',
  },
};

const defaultConfig = {
  icon: Zap,
  color: 'text-fg/50',
  bg: 'bg-fg/5',
  ring: 'ring-fg/10',
  label: 'Event',
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

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function timeAgo(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return '';
  }
}

export function ActivityTimeline({ onClose }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const today = new Date().toISOString().split('T')[0] ?? '';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [evts, sum] = await Promise.all([
        ipc.getTimeline(null, filterType, null, 500),
        ipc.getDailySummary(today),
      ]);
      setEvents(evts);
      setSummary(sum);
    } catch (err) {
      console.error('Failed to load timeline', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, today]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleExportStandup = useCallback(async () => {
    try {
      const since = Date.now() - 86_400_000;
      const text = await ipc.exportStandup(since);
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to export standup', err);
    }
  }, []);

  const grouped = useMemo(() => {
    const groups: Array<{ date: string; events: TimelineEvent[] }> = [];
    let currentDate = '';
    for (const e of events) {
      const d = formatDate(e.timestamp);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, events: [] });
      }
      groups[groups.length - 1]?.events.push(e);
    }
    return groups;
  }, [events]);

  const selectedEvent = events.find((e) => e.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-surface border-border animate-in slide-in-from-right relative flex h-full w-[640px] flex-col shadow-2xl duration-300">
        {/* Header */}
        <div className="border-border/60 flex flex-col border-b">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="bg-accent/10 flex h-7 w-7 items-center justify-center rounded-lg">
                <Terminal className="text-accent h-3.5 w-3.5" />
              </div>
              <h2 className="text-fg text-sm font-semibold tracking-tight">Activity</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void handleExportStandup()}
                className="hover:bg-fg/8 text-fg/40 hover:text-fg/70 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition"
                title="Copy standup summary"
              >
                <Copy size={11} />
                Standup
              </button>
              <button
                onClick={() => void refresh()}
                className="hover:bg-fg/8 text-fg/40 hover:text-fg/70 rounded-md p-1.5 transition"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* Summary pills */}
          {summary && (
            <div className="flex items-center gap-1.5 px-5 pb-3">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                {summary.services_started} starts
              </span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
                {summary.commits} commits
              </span>
              {summary.errors > 0 && (
                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                  {summary.errors} errors
                </span>
              )}
              <span className="text-fg/25 ml-auto text-[10px]">
                {summary.projects_worked} projects
              </span>
            </div>
          )}

          {/* Filter */}
          <div className="border-border/40 border-t px-5 py-2">
            <div className="flex items-center gap-1">
              {[
                { key: '', label: 'All' },
                { key: 'service_started', label: 'Start' },
                { key: 'service_crashed', label: 'Crash' },
                { key: 'git_commit', label: 'Commit' },
                { key: 'log_error', label: 'Error' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterType(f.key || null)}
                  className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition ${
                    (filterType ?? '') === f.key
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg/30 hover:bg-fg/5 hover:text-fg/50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="overlay-scroll flex-1 overflow-auto">
          {loading && (
            <div className="text-fg/30 flex flex-col items-center gap-2 py-16">
              <div className="border-fg/10 border-t-fg/30 h-5 w-5 animate-spin rounded-full border-2" />
              <span className="text-xs">Loading…</span>
            </div>
          )}
          {!loading && events.length === 0 && (
            <div className="text-fg/20 flex flex-col items-center gap-3 py-20">
              <Zap size={32} />
              <span className="text-fg/30 text-xs">No activity yet</span>
              <span className="text-fg/15 text-[10px]">Events appear as you work</span>
            </div>
          )}
          {!loading &&
            grouped.map((group) => (
              <div key={group.date} className="pb-2">
                {/* Date header */}
                <div className="text-fg/20 bg-surface sticky top-0 z-10 flex items-center gap-2 px-5 py-2 text-[10px] font-semibold tracking-[0.12em] uppercase backdrop-blur-sm">
                  <span className="bg-fg/8 h-px flex-1" />
                  <span>{group.date}</span>
                  <span className="bg-fg/8 h-px flex-1" />
                </div>

                {/* Events with node graph */}
                <div className="relative px-5">
                  {/* Vertical rail */}
                  <div className="bg-fg/6 absolute top-0 bottom-0 left-[29px] w-px" />

                  {group.events.map((e, i) => {
                    const cfg = eventConfig[e.event_type] ?? defaultConfig;
                    const Icon = cfg.icon;
                    const isSelected = selectedId === e.id;
                    const isLast = i === group.events.length - 1;
                    const nextIsSameService =
                      !isLast &&
                      group.events[i + 1]?.service_id === e.service_id &&
                      group.events[i + 1]?.service_id !== null;

                    return (
                      <div key={e.id} className="relative">
                        {/* Node + content */}
                        <div
                          className="group flex cursor-pointer items-start gap-3 py-1.5"
                          onClick={() => setSelectedId(isSelected ? null : e.id)}
                        >
                          {/* Node dot */}
                          <div className="relative z-10 mt-0.5 flex shrink-0">
                            <div
                              className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ring-1 ${cfg.bg} ${cfg.ring} transition-all group-hover:scale-110 ${
                                isSelected ? 'scale-125 !ring-2' : ''
                              }`}
                            >
                              <Icon size={9} className={`${cfg.color} shrink-0`} />
                            </div>
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1 pt-px">
                            <div className="flex items-baseline gap-1.5">
                              <span className={`text-[11.5px] font-medium ${cfg.color}`}>
                                {cfg.label}
                              </span>
                              {e.service_name && (
                                <span className="text-fg/50 text-[11px] font-medium">
                                  {e.service_name}
                                </span>
                              )}
                              <span className="text-fg/15 ml-auto shrink-0 text-[10px] tabular-nums">
                                {timeAgo(e.timestamp)}
                              </span>
                            </div>
                            <p className="text-fg/35 mt-0.5 truncate text-[10.5px] leading-snug">
                              {e.description}
                            </p>

                            {/* Expanded detail */}
                            {isSelected && (
                              <div className="bg-fg/3 mt-1.5 rounded-md p-2.5">
                                <div className="text-fg/40 flex items-center gap-2 text-[10px]">
                                  <span className="text-fg/20">ID</span>
                                  <span className="font-mono">{e.id}</span>
                                </div>
                                <div className="text-fg/40 flex items-center gap-2 text-[10px]">
                                  <span className="text-fg/20">Time</span>
                                  <span>{formatTime(e.timestamp)}</span>
                                </div>
                                {e.service_id && (
                                  <div className="text-fg/40 flex items-center gap-2 text-[10px]">
                                    <span className="text-fg/20">Service</span>
                                    <span className="font-mono">{e.service_id.slice(0, 8)}…</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Connector arrow to next same-service event */}
                        {nextIsSameService && (
                          <div className="absolute left-[37px] -mt-0.5">
                            <ArrowRightCircle size={6} className="text-fg/8 -rotate-90" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="border-border/40 border-t px-5 py-2.5">
          <div className="text-fg/15 flex items-center justify-between text-[10px]">
            <span>{events.length} events</span>
            {selectedEvent && (
              <span className="text-fg/25">{formatTime(selectedEvent.timestamp)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
