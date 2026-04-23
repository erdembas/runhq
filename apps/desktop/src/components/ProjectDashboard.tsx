import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  GitBranch,
  Package,
  RefreshCw,
  Shield,
  Skull,
  X,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/cn';
import type { AuditResult, OverviewSummary, OutdatedResult, ProjectOverview } from '@/types';

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
    const mins = Math.floor(diffMs / 60000);
    if (mins > 0) return `${mins}m ago`;
    return 'just now';
  } catch {
    return '\u2014';
  }
}

function cpuHeatColor(cpu: number): string {
  if (cpu > 200) return 'bg-red-500';
  if (cpu > 100) return 'bg-orange-500';
  if (cpu > 50) return 'bg-yellow-500';
  if (cpu > 10) return 'bg-green-400';
  if (cpu > 0) return 'bg-green-600';
  return 'bg-fg/10';
}

function memHeatColor(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) return 'bg-red-500';
  if (mb > 512) return 'bg-orange-500';
  if (mb > 128) return 'bg-yellow-500';
  if (mb > 32) return 'bg-green-400';
  if (mb > 0) return 'bg-green-600';
  return 'bg-fg/10';
}

type SortKey = 'name' | 'status' | 'activity' | 'runtime' | 'cpu' | 'memory' | 'outdated' | 'vulns';
type StatusFilter = 'all' | 'running' | 'stopped' | 'dirty' | 'stale';

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
    return (
      <span className="text-fg/40 inline-flex items-center gap-1 text-xs">
        <CheckCircle2 size={10} className="text-green-500" />
        {gs.branch ?? 'detached'}
      </span>
    );
  return (
    <span className="text-xs">
      <span className="text-fg/40">{gs.branch ?? 'detached'}</span>
      <span className="ml-1 text-yellow-400">{items.join(', ')}</span>
    </span>
  );
}

function OutdatedBadge({ outdated }: { outdated: OutdatedResult | null }) {
  if (!outdated || outdated.total === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-500">
        <Package size={10} /> OK
      </span>
    );
  const parts: string[] = [];
  if (outdated.major > 0) parts.push(`${outdated.major} major`);
  if (outdated.minor > 0) parts.push(`${outdated.minor} minor`);
  if (outdated.patch > 0) parts.push(`${outdated.patch} patch`);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-400">
      <Package size={10} />
      {outdated.total} ({parts.join(', ')})
    </span>
  );
}

function AuditBadge({ audit }: { audit: AuditResult | null }) {
  if (!audit) return <span className="text-fg/30 text-xs">{'\u2014'}</span>;
  const total = audit.critical + audit.high + audit.medium + audit.low;
  if (total === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-500">
        <Shield size={10} /> Clean
      </span>
    );
  const worst =
    audit.critical > 0 ? 'critical' : audit.high > 0 ? 'high' : audit.medium > 0 ? 'medium' : 'low';
  const color =
    worst === 'critical'
      ? 'text-red-400'
      : worst === 'high'
        ? 'text-orange-400'
        : worst === 'medium'
          ? 'text-yellow-400'
          : 'text-fg/50';
  const Icon = worst === 'critical' ? Skull : Shield;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', color)}>
      <Icon size={10} />
      {total} ({worst})
    </span>
  );
}

function HeatmapBar({ projects }: { projects: ProjectOverview[] }) {
  const maxCpu = Math.max(...projects.map((p) => p.cpu_percent), 1);
  const maxMem = Math.max(...projects.map((p) => p.memory_bytes), 1);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-fg/50 mb-1 text-[10px] font-medium tracking-wider uppercase">
          CPU Heatmap
        </div>
        <div className="flex gap-0.5">
          {projects.map((p) => (
            <div
              key={p.service_id}
              className={cn('h-6 flex-1 rounded-sm transition-all', cpuHeatColor(p.cpu_percent))}
              style={{ minWidth: 4 }}
              title={`${p.name}: ${p.cpu_percent.toFixed(1)}% CPU`}
            />
          ))}
        </div>
        <div className="text-fg/30 mt-1 flex justify-between text-[9px]">
          <span>0%</span>
          <span>{maxCpu.toFixed(0)}%</span>
        </div>
      </div>
      <div>
        <div className="text-fg/50 mb-1 text-[10px] font-medium tracking-wider uppercase">
          Memory Heatmap
        </div>
        <div className="flex gap-0.5">
          {projects.map((p) => (
            <div
              key={p.service_id}
              className={cn('h-6 flex-1 rounded-sm transition-all', memHeatColor(p.memory_bytes))}
              style={{ minWidth: 4 }}
              title={`${p.name}: ${formatBytes(p.memory_bytes)}`}
            />
          ))}
        </div>
        <div className="text-fg/30 mt-1 flex justify-between text-[9px]">
          <span>0</span>
          <span>{formatBytes(maxMem)}</span>
        </div>
      </div>
    </div>
  );
}

function GitStatusMatrix({ projects }: { projects: ProjectOverview[] }) {
  return (
    <div>
      <div className="text-fg/50 mb-2 text-[10px] font-medium tracking-wider uppercase">
        Git Status Matrix
      </div>
      <div className="overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-fg/40 border-fg/10 border-b text-left">
              <th className="pb-1.5 font-medium">Project</th>
              <th className="pb-1.5 font-medium">Branch</th>
              <th className="pb-1.5 text-center font-medium">Dirty</th>
              <th className="pb-1.5 text-center font-medium">Ahead</th>
              <th className="pb-1.5 text-center font-medium">Behind</th>
              <th className="pb-1.5 font-medium">Last Commit</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const gs = p.git_status;
              return (
                <tr key={p.service_id} className="border-fg/5 border-b">
                  <td className="py-1.5 font-medium">{p.name}</td>
                  <td className="text-fg/50 py-1.5">
                    {gs?.branch ?? (gs ? 'detached' : '\u2014')}
                  </td>
                  <td className="py-1.5 text-center">
                    {gs?.is_dirty ? (
                      <span className="inline-flex items-center justify-center rounded bg-yellow-500/20 px-1.5 py-0.5 text-yellow-400">
                        {gs.dirty_count}
                      </span>
                    ) : (
                      <span className="text-fg/20">{gs ? '0' : '\u2014'}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-center">
                    {gs && gs.ahead > 0 ? (
                      <span className="inline-flex items-center justify-center rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-400">
                        {gs.ahead}
                      </span>
                    ) : (
                      <span className="text-fg/20">{gs ? '0' : '\u2014'}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-center">
                    {gs && gs.behind > 0 ? (
                      <span className="inline-flex items-center justify-center rounded bg-orange-500/20 px-1.5 py-0.5 text-orange-400">
                        {gs.behind}
                      </span>
                    ) : (
                      <span className="text-fg/20">{gs ? '0' : '\u2014'}</span>
                    )}
                  </td>
                  <td className="text-fg/50 py-1.5">
                    {gs?.last_commit
                      ? `${gs.last_commit.hash_short} ${gs.last_commit.subject.slice(0, 30)}`
                      : '\u2014'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'matrix' | 'heatmap';

export function ProjectDashboard() {
  const closeOverview = useAppStore((s) => s.closeOverview);
  const [overview, setOverview] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await ipc.getProjectOverview(30);
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

  const runtimes = useMemo(() => {
    if (!overview) return [];
    const set = new Set<string>();
    for (const p of overview.projects) {
      if (p.runtime) set.add(p.runtime);
    }
    return Array.from(set).sort();
  }, [overview]);

  const filteredProjects = useMemo(() => {
    let list = [...(overview?.projects ?? [])];
    switch (statusFilter) {
      case 'running':
        list = list.filter((p) => p.is_running);
        break;
      case 'stopped':
        list = list.filter((p) => !p.is_running);
        break;
      case 'dirty':
        list = list.filter((p) => p.git_status?.is_dirty);
        break;
      case 'stale':
        list = list.filter((p) => p.is_stale);
        break;
    }
    if (runtimeFilter !== 'all') {
      list = list.filter((p) => p.runtime === runtimeFilter);
    }
    return list;
  }, [overview, statusFilter, runtimeFilter]);

  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
      switch (sortBy) {
        case 'status':
          return (b.is_running ? 1 : 0) - (a.is_running ? 1 : 0);
        case 'activity':
          return (b.last_activity ?? '').localeCompare(a.last_activity ?? '');
        case 'runtime':
          return (a.runtime ?? 'zzz').localeCompare(b.runtime ?? 'zzz');
        case 'cpu':
          return b.cpu_percent - a.cpu_percent;
        case 'memory':
          return b.memory_bytes - a.memory_bytes;
        case 'outdated':
          return (b.outdated?.total ?? 0) - (a.outdated?.total ?? 0);
        case 'vulns': {
          const bv = (b.audit?.critical ?? 0) + (b.audit?.high ?? 0) + (b.audit?.medium ?? 0);
          const av = (a.audit?.critical ?? 0) + (a.audit?.high ?? 0) + (a.audit?.medium ?? 0);
          return bv - av;
        }
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [filteredProjects, sortBy]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[3px]" onClick={closeOverview} />
      <div className="bg-surface border-border relative z-10 flex h-[85vh] w-[90vw] max-w-[1200px] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-fg text-sm font-semibold">Project Overview</h2>
            <div className="border-border flex items-center gap-0.5 rounded-md border px-0.5 py-0.5">
              {(['overview', 'matrix', 'heatmap'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-[10px] font-semibold transition',
                    tab === t ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:text-fg',
                  )}
                >
                  {t === 'overview' ? 'Overview' : t === 'matrix' ? 'Git Matrix' : 'Heatmap'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="text-fg/50 hover:text-fg transition"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button onClick={closeOverview} className="text-fg/50 hover:text-fg transition">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && <p className="text-fg/40 text-sm">Loading{'\u2026'}</p>}

          {!loading && overview && (
            <>
              <div className="mb-4 grid grid-cols-6 gap-2">
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 text-[10px] tracking-wider uppercase">Running</div>
                  <div className="text-fg text-lg font-semibold">
                    {overview.total_running}/{overview.total_running + overview.total_stopped}
                  </div>
                </div>
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                    <AlertTriangle size={8} /> Dirty
                  </div>
                  <div className="text-lg font-semibold text-yellow-400">
                    {overview.total_dirty}
                  </div>
                </div>
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                    <GitBranch size={8} /> Behind
                  </div>
                  <div className="text-lg font-semibold text-orange-400">
                    {overview.total_behind}
                  </div>
                </div>
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                    <Clock size={8} /> Stale
                  </div>
                  <div className="text-fg/60 text-lg font-semibold">{overview.stale_count}</div>
                </div>
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                    <Package size={8} /> Outdated
                  </div>
                  <div className="text-lg font-semibold text-orange-400">
                    {overview.total_outdated}
                  </div>
                </div>
                <div className="bg-fg/5 rounded-lg p-2.5">
                  <div className="text-fg/50 flex items-center gap-1 text-[10px] tracking-wider uppercase">
                    <Shield size={8} /> CVEs
                  </div>
                  <div className="text-lg font-semibold text-red-400">
                    {overview.total_vulnerabilities}
                  </div>
                </div>
              </div>

              {tab === 'heatmap' && <HeatmapBar projects={sortedProjects} />}

              {tab === 'matrix' && <GitStatusMatrix projects={sortedProjects} />}

              {tab === 'overview' && (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <Filter size={12} className="text-fg/40" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      className="bg-surface border-border text-fg/70 rounded border px-2 py-1 text-[11px]"
                    >
                      <option value="all">All status</option>
                      <option value="running">Running</option>
                      <option value="stopped">Stopped</option>
                      <option value="dirty">Dirty</option>
                      <option value="stale">Stale</option>
                    </select>
                    <select
                      value={runtimeFilter}
                      onChange={(e) => setRuntimeFilter(e.target.value)}
                      className="bg-surface border-border text-fg/70 rounded border px-2 py-1 text-[11px]"
                    >
                      <option value="all">All runtimes</option>
                      {runtimes.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortKey)}
                      className="bg-surface border-border text-fg/70 rounded border px-2 py-1 text-[11px]"
                    >
                      <option value="name">Sort: Name</option>
                      <option value="status">Sort: Status</option>
                      <option value="activity">Sort: Activity</option>
                      <option value="runtime">Sort: Runtime</option>
                      <option value="cpu">Sort: CPU</option>
                      <option value="memory">Sort: Memory</option>
                      <option value="outdated">Sort: Outdated</option>
                      <option value="vulns">Sort: Vulnerabilities</option>
                    </select>
                  </div>

                  {!loading && sortedProjects.length === 0 && (
                    <p className="text-fg/40 text-sm">No projects match filters</p>
                  )}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-fg/40 border-fg/10 border-b text-left">
                        <th className="pb-2 font-medium">Project</th>
                        <th className="pb-2 font-medium">Runtime</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Git</th>
                        <th className="pb-2 font-medium">CPU</th>
                        <th className="pb-2 font-medium">Mem</th>
                        <th className="pb-2 font-medium">Deps</th>
                        <th className="pb-2 font-medium">Audit</th>
                        <th className="pb-2 font-medium">Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProjects.map((p) => (
                        <tr
                          key={p.service_id}
                          className={cn(
                            'border-fg/5 border-b transition-colors',
                            p.is_stale ? 'bg-orange-500/5' : 'hover:bg-fg/5',
                          )}
                        >
                          <td className="py-2 font-medium">
                            {p.name}
                            {p.is_stale && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-orange-500/15 px-1 py-0.5 text-[9px] text-orange-400">
                                <Clock size={8} /> stale
                              </span>
                            )}
                          </td>
                          <td className="text-fg/50 py-2">{p.runtime ?? '\u2014'}</td>
                          <td className="py-2">
                            <StatusBadge project={p} />
                          </td>
                          <td className="py-2">
                            <GitBadge project={p} />
                          </td>
                          <td className="py-2">
                            <span
                              className={cn(
                                'inline-block h-2 w-8 rounded-sm',
                                cpuHeatColor(p.cpu_percent),
                              )}
                              title={`${p.cpu_percent.toFixed(1)}%`}
                            />
                          </td>
                          <td className="text-fg/50 py-2 tabular-nums">
                            {p.memory_bytes > 0 ? formatBytes(p.memory_bytes) : '\u2014'}
                          </td>
                          <td className="py-2">
                            <OutdatedBadge outdated={p.outdated} />
                          </td>
                          <td className="py-2">
                            <AuditBadge audit={p.audit} />
                          </td>
                          <td className="text-fg/50 py-2">{timeAgo(p.last_activity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
