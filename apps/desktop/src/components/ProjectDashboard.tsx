import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, GitBranch, HardDrive, RefreshCw, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import type { OverviewSummary, ProjectOverview } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  try {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days > 30) return `${Math.floor(days / 30)}mo ago`;
    if (days > 0) return `${days}d ago`;
    const hours = Math.floor(diffMs / 3600000);
    if (hours > 0) return `${hours}h ago`;
    return 'just now';
  } catch {
    return '\u2014';
  }
}

function StatusBadge({ project }: { project: ProjectOverview }) {
  if (project.is_running) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-400">
        <Activity size={10} /> Running
      </span>
    );
  }
  return <span className="text-fg/40 text-xs">Stopped</span>;
}

function GitBadge({ project }: { project: ProjectOverview }) {
  const gs = project.git_status;
  if (!gs) return <span className="text-fg/30 text-xs">{'\u2014'}</span>;
  const items: string[] = [];
  if (gs.is_dirty) items.push(`${gs.dirty_count} dirty`);
  if (gs.behind > 0) items.push(`${gs.behind} behind`);
  if (gs.ahead > 0) items.push(`${gs.ahead} ahead`);
  if (items.length === 0)
    return <span className="text-fg/40 text-xs">{gs.branch ?? 'detached'}</span>;
  return (
    <span className="text-xs">
      <span className="text-fg/40">{gs.branch ?? 'detached'}</span>
      <span className="ml-1 text-yellow-400">{items.join(', ')}</span>
    </span>
  );
}

export function ProjectDashboard() {
  const closeOverview = useAppStore((s) => s.closeOverview);
  const [overview, setOverview] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'activity' | 'runtime'>('name');

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await ipc.getProjectOverview();
      setOverview(data);
    } catch (err) {
      console.error('Failed to load overview', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const sortedProjects = [...(overview?.projects ?? [])].sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return (b.is_running ? 1 : 0) - (a.is_running ? 1 : 0);
      case 'activity':
        return (b.last_activity ?? '').localeCompare(a.last_activity ?? '');
      case 'runtime':
        return (a.runtime ?? 'zzz').localeCompare(b.runtime ?? 'zzz');
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={closeOverview} />
      <div className="bg-surface border-border relative z-10 flex w-[640px] max-w-[90vw] flex-col overflow-hidden border-l shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-fg text-sm font-semibold">Project Overview</h2>
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-surface border-border text-fg/70 rounded border px-2 py-1 text-xs"
            >
              <option value="name">Name</option>
              <option value="status">Status</option>
              <option value="activity">Activity</option>
              <option value="runtime">Runtime</option>
            </select>
            <button onClick={() => void refresh()} className="text-fg/50 hover:text-fg transition">
              <RefreshCw size={14} />
            </button>
            <button onClick={closeOverview} className="text-fg/50 hover:text-fg transition">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {overview && (
            <div className="mb-4 grid grid-cols-4 gap-3">
              <div className="bg-fg/5 rounded-lg p-3">
                <div className="text-fg/50 text-[10px] tracking-wider uppercase">Running</div>
                <div className="text-fg text-lg font-semibold">
                  {overview.total_running}/{overview.total_running + overview.total_stopped}
                </div>
              </div>
              <div className="bg-fg/5 rounded-lg p-3">
                <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                  <AlertTriangle size={8} /> Dirty
                </div>
                <div className="text-lg font-semibold text-yellow-400">{overview.total_dirty}</div>
              </div>
              <div className="bg-fg/5 rounded-lg p-3">
                <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                  <GitBranch size={8} /> Behind
                </div>
                <div className="text-lg font-semibold text-orange-400">{overview.total_behind}</div>
              </div>
              <div className="bg-fg/5 rounded-lg p-3">
                <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                  <HardDrive size={8} /> Memory
                </div>
                <div className="text-fg text-lg font-semibold">
                  {formatBytes(overview.total_memory)}
                </div>
              </div>
            </div>
          )}

          {loading && <p className="text-fg/40 text-sm">Loading{'\u2026'}</p>}
          {!loading && sortedProjects.length === 0 && (
            <p className="text-fg/40 text-sm">No projects registered</p>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-fg/40 border-fg/10 border-b text-left">
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Runtime</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Git</th>
                <th className="pb-2 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p) => (
                <tr key={p.service_id} className="border-fg/5 hover:bg-fg/5 border-b">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td className="text-fg/50 py-2">{p.runtime ?? '\u2014'}</td>
                  <td className="py-2">
                    <StatusBadge project={p} />
                  </td>
                  <td className="py-2">
                    <GitBadge project={p} />
                  </td>
                  <td className="text-fg/50 py-2">{timeAgo(p.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
