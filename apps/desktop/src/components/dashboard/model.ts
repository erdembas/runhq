import type { CSSProperties } from 'react';
import type { DashboardGroupBy, DashboardSortBy } from '@/store/useAppStore';
import { riskScore } from '@/lib/risk';
import type {
  GitStatus,
  OverviewSummary,
  ProjectOverview,
  SectionId,
  ServiceDef,
  Status,
} from '@/types';

export type ServiceOverlayKind = 'license';
export type GitFilter = 'all' | 'dirty' | 'clean' | 'ahead' | 'behind' | 'no-upstream';
export type AttentionFilter = 'all' | 'stale' | 'risk' | 'outdated' | 'license';
export type WorkspaceTone = 'critical' | 'warning' | 'running' | 'idle';

export interface DashboardStats {
  running: number;
  starting: number;
  stopped: number;
  failed: number;
}

export interface DashboardTotals {
  cpu: number;
  mem: number;
}

export interface HeroState {
  count?: number;
  label: string;
  tone: WorkspaceTone;
}

export interface AttentionStats {
  stale: number;
  dirty: number;
  risk: number;
  outdated: number;
  cveCritical: number;
  cveHigh: number;
  cveMedium: number;
  cveLow: number;
  outdatedPackages: number;
  licenseRisk: number;
  licenseWarnings: number;
  hasDepScan: boolean;
}

export interface GitStats {
  dirty: number;
  clean: number;
  ahead: number;
  behind: number;
  noUpstream: number;
}

export type DashGroup = {
  key: string;
  label: string;
  dotClass?: string;
  labelClass?: string;
  dotStyle?: CSSProperties;
  labelStyle?: CSSProperties;
  services: ServiceDef[];
};

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

export const STALE_SCAN_THRESHOLD_MS = 7 * 24 * 60 * 60_000;
export const UNASSIGNED: SectionId = '__unassigned__';

export const GROUP_OPTIONS: Array<{
  key: DashboardGroupBy;
  label: string;
  description: string;
}> = [
  { key: 'none', label: 'Section', description: 'Your custom sections' },
  { key: 'category', label: 'Category', description: 'Backend, frontend, mobile…' },
  { key: 'runtime', label: 'Runtime', description: 'Node, Rust, Go, Python…' },
  { key: 'status', label: 'Status', description: 'Running vs stopped' },
];

export const SORT_OPTIONS: Array<{
  key: DashboardSortBy;
  label: string;
  description: string;
}> = [
  { key: 'name', label: 'Name', description: 'Alphabetical (stable)' },
  { key: 'activity', label: 'Last activity', description: 'Most recent commit first' },
  { key: 'risk', label: 'Risk', description: 'CVE + outdated composite' },
  { key: 'memory', label: 'Memory', description: 'Running projects by RSS' },
  { key: 'cpu', label: 'CPU', description: 'Running projects by CPU%' },
];

export const TONE_CLASSES: Record<
  WorkspaceTone,
  { count: string; dot: string; backdrop: string | null }
> = {
  critical: {
    count: 'text-status-error',
    dot: 'bg-status-error shadow-[0_0_8px_rgb(var(--status-error)/0.55)]',
    backdrop: 'rgb(var(--status-error) / 0.07)',
  },
  warning: {
    count: 'text-tone-warning-fg',
    dot: 'bg-tone-warning shadow-[0_0_8px_rgb(var(--tone-warning)/0.5)]',
    backdrop: 'rgb(var(--tone-warning) / 0.07)',
  },
  running: {
    count: 'text-status-running',
    dot: 'bg-status-running shadow-[0_0_8px_rgb(var(--status-running)/0.55)]',
    backdrop: 'rgb(var(--accent) / 0.08)',
  },
  idle: {
    count: 'text-fg-muted',
    dot: 'bg-fg-dim/70',
    backdrop: null,
  },
};

export function searchScore(svc: ServiceDef, needle: string): number {
  if (!needle) return 0;
  const q = needle.toLowerCase();
  let score = 0;
  if (svc.name.toLowerCase().includes(q)) score += 10;
  for (const t of svc.tags) {
    if (t.toLowerCase().includes(q)) {
      score += 5;
      break;
    }
  }
  if (svc.port != null && String(svc.port).includes(q)) score += 4;
  for (const c of svc.cmds) {
    if (c.cmd.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) {
      score += 3;
      break;
    }
  }
  if (svc.cwd.toLowerCase().includes(q)) score += 2;
  return score;
}

export function scanFreshnessLabel(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return 'Scanned just now';
  if (diff < 3_600_000) return `Scanned ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Scanned ${Math.floor(diff / 3_600_000)}h ago`;
  return `Scanned ${Math.floor(diff / 86_400_000)}d ago`;
}

export function deriveHeroState(
  stats: DashboardStats,
  attention: Pick<AttentionStats, 'cveCritical' | 'licenseRisk' | 'outdated'> | null,
): HeroState {
  if (stats.failed > 0) {
    return {
      count: stats.failed,
      label: stats.failed === 1 ? 'service needs attention' : 'services need attention',
      tone: 'critical',
    };
  }
  if (attention && attention.cveCritical > 0) {
    return {
      count: attention.cveCritical,
      label: attention.cveCritical === 1 ? 'critical CVE' : 'critical CVEs',
      tone: 'critical',
    };
  }
  if (attention && attention.licenseRisk > 0) {
    return {
      count: attention.licenseRisk,
      label: attention.licenseRisk === 1 ? 'project at license risk' : 'projects at license risk',
      tone: 'critical',
    };
  }
  if (stats.running > 0) {
    return {
      count: stats.running,
      label: stats.running === 1 ? 'service running' : 'services running',
      tone: 'running',
    };
  }
  if (attention && attention.outdated > 0) {
    return {
      count: attention.outdated,
      label: attention.outdated === 1 ? 'project outdated' : 'projects outdated',
      tone: 'warning',
    };
  }
  return { label: 'Workspace idle', tone: 'idle' };
}

export function calculateStats(
  services: ServiceDef[],
  statuses: Record<string, { status: Status }>,
) {
  const stats: DashboardStats = { running: 0, starting: 0, stopped: 0, failed: 0 };
  for (const svc of services) {
    const st = statuses[svc.id]?.status ?? 'stopped';
    if (st === 'running') stats.running++;
    else if (st === 'starting' || st === 'stopping') stats.starting++;
    else if (st === 'crashed' || st === 'exited') stats.failed++;
    else stats.stopped++;
  }
  return stats;
}

export function calculateAttentionStats(overview: OverviewSummary | null) {
  if (!overview) return null;
  const stats: AttentionStats = {
    stale: 0,
    dirty: 0,
    risk: 0,
    outdated: 0,
    cveCritical: 0,
    cveHigh: 0,
    cveMedium: 0,
    cveLow: 0,
    outdatedPackages: 0,
    licenseRisk: 0,
    licenseWarnings: 0,
    hasDepScan: overview.has_dependency_scan,
  };
  for (const p of overview.projects) {
    if (p.is_stale) stats.stale++;
    if (p.git_status?.is_dirty) stats.dirty++;
    const critical = p.audit?.critical ?? 0;
    const high = p.audit?.high ?? 0;
    stats.cveCritical += critical;
    stats.cveHigh += high;
    stats.cveMedium += p.audit?.medium ?? 0;
    stats.cveLow += p.audit?.low ?? 0;
    if (critical + high > 0) stats.risk++;
    const outdated = p.outdated?.total ?? 0;
    if (outdated > 0) stats.outdated++;
    stats.outdatedPackages += outdated;
    const lic = p.license;
    const licenseTotal = lic
      ? (lic.strong_copyleft_count ?? 0) +
        (lic.network_copyleft_count ?? 0) +
        (lic.proprietary_count ?? 0)
      : 0;
    if (licenseTotal > 0) stats.licenseRisk++;
    stats.licenseWarnings += licenseTotal;
  }
  return stats;
}

export function calculateGitStats(services: ServiceDef[], git: Record<string, GitStatus | null>) {
  const stats: GitStats = { dirty: 0, clean: 0, ahead: 0, behind: 0, noUpstream: 0 };
  for (const svc of services) {
    const g = git[svc.id];
    if (g === null || g === undefined) continue;
    if (g.is_dirty) stats.dirty++;
    else stats.clean++;
    if (g.ahead > 0) stats.ahead++;
    if (g.behind > 0) stats.behind++;
    if (!g.upstream) stats.noUpstream++;
  }
  return stats;
}

export function buildGitPredicate(filter: GitFilter) {
  if (filter === 'all') return (_svc: ServiceDef, _g: GitStatus | null | undefined) => true;
  const predicates: Record<
    Exclude<GitFilter, 'all'>,
    (_svc: ServiceDef, g: GitStatus | null | undefined) => boolean
  > = {
    dirty: (_s, g) => g !== null && g !== undefined && g.is_dirty,
    clean: (_s, g) => g !== null && g !== undefined && !g.is_dirty,
    ahead: (_s, g) => g !== null && g !== undefined && g.ahead > 0,
    behind: (_s, g) => g !== null && g !== undefined && g.behind > 0,
    'no-upstream': (_s, g) => g !== null && g !== undefined && !g.upstream,
  };
  return predicates[filter] ?? (() => true);
}

export function matchesAttentionFilter(
  filter: AttentionFilter,
  svc: ServiceDef,
  projectMetaById: ReadonlyMap<string, ProjectOverview>,
) {
  if (filter === 'all') return true;
  const meta = projectMetaById.get(svc.id);
  if (!meta) return false;
  if (filter === 'stale') return meta.is_stale;
  if (filter === 'risk') return (meta.audit?.critical ?? 0) + (meta.audit?.high ?? 0) > 0;
  if (filter === 'outdated') return (meta.outdated?.total ?? 0) > 0;
  const lic = meta.license;
  if (!lic) return false;
  return (
    (lic.strong_copyleft_count ?? 0) +
      (lic.network_copyleft_count ?? 0) +
      (lic.proprietary_count ?? 0) >
    0
  );
}

export function buildServiceComparator(args: {
  sortBy: DashboardSortBy;
  projectMetaById: ReadonlyMap<string, ProjectOverview>;
  runningServiceIds: ReadonlySet<string>;
  resources: Record<string, { cpu_percent: number; memory_bytes: number }>;
  effectiveQuery: string;
}) {
  const { sortBy, projectMetaById, runningServiceIds, resources, effectiveQuery } = args;
  const byName = (a: ServiceDef, b: ServiceDef) => a.name.localeCompare(b.name);
  const bySearch =
    effectiveQuery !== ''
      ? (a: ServiceDef, b: ServiceDef) =>
          searchScore(b, effectiveQuery) - searchScore(a, effectiveQuery)
      : null;
  const withSearch =
    (axis: (a: ServiceDef, b: ServiceDef) => number) => (a: ServiceDef, b: ServiceDef) => {
      const searchResult = bySearch?.(a, b) ?? 0;
      return searchResult !== 0 ? searchResult : axis(a, b);
    };

  if (sortBy === 'activity') {
    return withSearch((a, b) => {
      const ta = projectMetaById.get(a.id)?.last_activity
        ? new Date(projectMetaById.get(a.id)!.last_activity!).getTime()
        : 0;
      const tb = projectMetaById.get(b.id)?.last_activity
        ? new Date(projectMetaById.get(b.id)!.last_activity!).getTime()
        : 0;
      return tb !== ta ? tb - ta : byName(a, b);
    });
  }
  if (sortBy === 'risk') {
    return withSearch((a, b) => {
      const diff = riskScore(projectMetaById.get(b.id)) - riskScore(projectMetaById.get(a.id));
      return diff !== 0 ? diff : byName(a, b);
    });
  }
  if (sortBy === 'memory') {
    return withSearch((a, b) => {
      const ma = runningServiceIds.has(a.id) ? (resources[a.id]?.memory_bytes ?? 0) : -1;
      const mb = runningServiceIds.has(b.id) ? (resources[b.id]?.memory_bytes ?? 0) : -1;
      return mb !== ma ? mb - ma : byName(a, b);
    });
  }
  if (sortBy === 'cpu') {
    return withSearch((a, b) => {
      const ca = runningServiceIds.has(a.id) ? (resources[a.id]?.cpu_percent ?? 0) : -1;
      const cb = runningServiceIds.has(b.id) ? (resources[b.id]?.cpu_percent ?? 0) : -1;
      return cb !== ca ? cb - ca : byName(a, b);
    });
  }
  return withSearch(byName);
}
