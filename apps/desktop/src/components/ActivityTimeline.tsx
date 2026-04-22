import { useCallback, useEffect, useState } from 'react';
import {
  X,
  Play,
  Square,
  AlertTriangle,
  GitCommit,
  GitMerge,
  GitBranch,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { TimelineEvent, DailySummary } from '@/types';

interface ActivityTimelineProps {
  onClose: () => void;
}

const eventIcon: Record<string, typeof Play> = {
  service_started: Play,
  service_stopped: Square,
  service_crashed: AlertTriangle,
  git_commit: GitCommit,
  git_push: GitMerge,
  git_checkout: GitBranch,
  log_error: AlertTriangle,
  log_warning: AlertTriangle,
};

const eventColor: Record<string, string> = {
  service_started: 'text-green-400',
  service_stopped: 'text-fg/40',
  service_crashed: 'text-red-400',
  git_commit: 'text-blue-400',
  git_push: 'text-purple-400',
  git_checkout: 'text-cyan-400',
  log_error: 'text-red-400',
  log_warning: 'text-yellow-400',
};

const eventLabel: Record<string, string> = {
  service_started: 'Started',
  service_stopped: 'Stopped',
  service_crashed: 'Crashed',
  git_commit: 'Commit',
  git_push: 'Push',
  git_checkout: 'Checkout',
  log_error: 'Error',
  log_warning: 'Warning',
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ActivityTimeline({ onClose }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string | null>(null);

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

  let lastDate = '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border-border flex h-[85vh] w-[80vw] min-w-[700px] flex-col overflow-hidden rounded-lg border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-fg text-sm font-semibold">Activity Timeline</h2>
            {summary && (
              <div className="text-fg/40 flex items-center gap-2 text-xs">
                <span>{summary.projects_worked} projects</span>
                <span>·</span>
                <span>{summary.commits} commits</span>
                <span>·</span>
                <span>{summary.services_started} starts</span>
                {summary.errors > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-red-400">{summary.errors} errors</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterType ?? ''}
              onChange={(e) => setFilterType(e.target.value || null)}
              className="bg-surface border-border text-fg/70 rounded border px-2 py-1 text-xs"
            >
              <option value="">All events</option>
              <option value="service_started">Service started</option>
              <option value="service_stopped">Service stopped</option>
              <option value="service_crashed">Crashes</option>
              <option value="git_commit">Commits</option>
              <option value="git_push">Pushes</option>
              <option value="log_error">Errors</option>
            </select>
            <button
              onClick={() => void handleExportStandup()}
              className="text-fg/50 hover:text-fg flex items-center gap-1 text-xs"
              title="Copy standup summary"
            >
              <Copy size={12} />
              Standup
            </button>
            <button onClick={() => void refresh()} className="text-fg/50 hover:text-fg">
              <RefreshCw size={14} />
            </button>
            <button onClick={onClose} className="text-fg/60 hover:text-fg cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-2">
          {loading && <p className="text-fg/40 py-8 text-center text-sm">Loading…</p>}
          {!loading && events.length === 0 && (
            <p className="text-fg/40 py-8 text-center text-sm">No activity recorded yet</p>
          )}
          {events.map((e) => {
            const dateStr = formatDate(e.timestamp);
            const showDate = dateStr !== lastDate;
            if (showDate) lastDate = dateStr;
            const Icon = eventIcon[e.event_type] ?? Play;
            const color = eventColor[e.event_type] ?? 'text-fg/50';
            const label = eventLabel[e.event_type] ?? e.event_type;

            return (
              <div key={e.id}>
                {showDate && (
                  <div className="text-fg/30 mt-4 mb-2 text-[10px] font-medium tracking-wider uppercase first:mt-0">
                    {dateStr}
                  </div>
                )}
                <div className="hover:bg-fg/5 -mx-2 flex items-center gap-3 rounded px-2 py-1.5">
                  <span className="text-fg/30 w-12 shrink-0 text-xs tabular-nums">
                    {formatTime(e.timestamp)}
                  </span>
                  <Icon size={14} className={`shrink-0 ${color}`} />
                  <span className={`shrink-0 text-xs font-medium ${color}`}>{label}</span>
                  {e.service_name && (
                    <span className="text-fg/60 shrink-0 text-xs font-medium">
                      {e.service_name}
                    </span>
                  )}
                  <span className="text-fg/50 min-w-0 flex-1 truncate text-xs">
                    {e.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
