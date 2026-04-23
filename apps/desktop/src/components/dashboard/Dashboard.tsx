import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  Clock,
  Cpu,
  FolderSearch,
  GitBranch,
  Layers,
  Loader2,
  MemoryStick,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { Select } from '@/components/ui/Select';
import { ProjectDetailDrawer, type DetailTab } from '@/components/ProjectDetailDrawer';
import { useAppStore, type DashboardGroupBy, type DashboardSortBy } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import { formatBytes, formatPercent } from '@/lib/format';
import { categoryForTags, CATEGORIES } from '@/lib/categories';
import { runtimeFromTags, inferRuntimeFromCmds, runtimeMeta, RUNTIMES } from '@/lib/runtimes';
import { sectionColor } from '@/lib/sectionColors';
import { modChord } from '@/lib/platform';
import type { ProjectOverview, SectionId, ServiceDef, Status } from '@/types';
import type { GitStatus } from '@/types';
import { ServiceCard } from './ServiceCard';
import { WorstOffenders } from './WorstOffenders';
import { riskScore } from '@/lib/risk';
import { ResourceHeatmap } from './ResourceHeatmap';
import { SectionHeader, HeaderAction } from './SectionHeader';
import { ActivityTimeline } from '@/components/ActivityTimeline';

interface Props {
  onScan: () => void;
}

type DashGroup = {
  key: string;
  label: string;
  dotClass?: string;
  labelClass?: string;
  dotStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  services: ServiceDef[];
};

/**
 * Group axis options. Descriptions surface in the dropdown item's
 * secondary line — "why would I pick this?" without a tooltip hover.
 */
const GROUP_OPTIONS: Array<{
  key: DashboardGroupBy;
  label: string;
  description: string;
}> = [
  // `none` is a misnomer in the store (kept for backward compatibility
  // with existing prefs in localStorage); the actual behaviour is
  // "group by user-defined Section" (Active / Archive / custom).
  { key: 'none', label: 'Section', description: 'Your custom sections' },
  { key: 'category', label: 'Category', description: 'Backend, frontend, mobile…' },
  { key: 'runtime', label: 'Runtime', description: 'Node, Rust, Go, Python…' },
  { key: 'status', label: 'Status', description: 'Running vs stopped' },
];

/**
 * Sort axis options.
 *
 * Ordering here is intentional:
 *   1. Name — the "boring" default that guarantees stable card layout.
 *   2. Activity / Risk — health-focused (answers "what needs me?").
 *   3. Memory / CPU — resource-focused (answers "what's hot?").
 * The user's eye scans top-to-bottom; the most common answer ("which
 * project should I fix first?") sits closest to the natural cursor.
 */
const SORT_OPTIONS: Array<{
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

const UNASSIGNED: SectionId = '__unassigned__';

/**
 * "Last scan" label for the dependency scan freshness indicator.
 *
 * Rolls up to minutes/hours/days because second-level precision on a
 * scan that takes 10-60s would flicker annoyingly. For the first
 * minute we just say "just now" — the user triggered it, they already
 * know it was a moment ago.
 */
function scanFreshnessLabel(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return 'Scanned just now';
  if (diff < 3_600_000) return `Scanned ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Scanned ${Math.floor(diff / 3_600_000)}h ago`;
  return `Scanned ${Math.floor(diff / 86_400_000)}d ago`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ onScan }: Props) {
  const services = useAppStore((s) => s.services);
  const statuses = useAppStore((s) => s.statuses);
  const resources = useAppStore((s) => s.resources);
  const ports = useAppStore((s) => s.ports);
  const appVersion = useAppStore((s) => s.appVersion);
  const openEditor = useAppStore((s) => s.openEditor);
  const stacks = useAppStore((s) => s.stacks);
  const removeStack = useAppStore((s) => s.removeStack);
  const openStackEditor = useAppStore((s) => s.openStackEditor);
  const setSelectedStack = useAppStore((s) => s.setSelectedStack);
  const upsertStack = useAppStore((s) => s.upsertStack);
  const git = useAppStore((s) => s.git);
  const groupBy = useAppStore((s) => s.dashboardGroupBy);
  const setGroupBy = useAppStore((s) => s.setDashboardGroupBy);
  const sortBy = useAppStore((s) => s.dashboardSortBy);
  const setSortBy = useAppStore((s) => s.setDashboardSortBy);
  const sections = useAppStore((s) => s.sections);
  const serviceSection = useAppStore((s) => s.serviceSection);
  const overview = useAppStore((s) => s.overview);
  const overviewScanning = useAppStore((s) => s.overviewScanning);
  const setOverviewScanning = useAppStore((s) => s.setOverviewScanning);
  const patchOverviewScan = useAppStore((s) => s.patchOverviewScan);
  const lastScanAt = useAppStore((s) => s.lastScanAt);
  const editors = useAppStore((s) => s.editors);

  // Tick `now` every 30s so the "Last scan: 4m ago" label re-renders
  // as time passes. Using a local state (not a global store) keeps the
  // re-render scoped to the dashboard — no point waking up the sidebar
  // every 30s just because the deps label needs updating.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastScanAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [lastScanAt]);

  // Git filters stay as they were (single-select) — they slice the roster
  // along the "what's in the repo?" axis. Attention filters (stale / risk /
  // outdated) layer on top and use the "dependency-scan axis"; keeping
  // them as a separate single-select avoids the combinatorial explosion
  // of N×M filter chip states.
  type GitFilter = 'all' | 'dirty' | 'clean' | 'ahead' | 'behind' | 'no-upstream';
  type AttentionFilter = 'all' | 'stale' | 'risk' | 'outdated';
  const [gitFilter, setGitFilter] = useState<GitFilter>('all');
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all');

  // Detail drawer lives at the dashboard level so flipping between
  // different cards' deps/audit chips just swaps the drawer contents
  // rather than unmount/remount on every click.
  const [detail, setDetail] = useState<{ serviceId: string; tab: DetailTab } | null>(null);
  const openDetail = useCallback((serviceId: string, tab: DetailTab) => {
    setDetail({ serviceId, tab });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // Index overview projects by service id for O(1) lookup while iterating
  // the service list. Stable reference so `ServiceCard`s don't re-render
  // every time *any* overview field changes unrelated to them.
  const projectMetaById = useMemo(() => {
    const map = new Map<string, ProjectOverview>();
    if (overview) for (const p of overview.projects) map.set(p.service_id, p);
    return map;
  }, [overview]);

  const runScan = useCallback(async () => {
    if (overviewScanning) return;
    setOverviewScanning(true);
    try {
      const result = await ipc.scanProjectDependencies(true);
      patchOverviewScan(result);
    } catch (err) {
      console.error('scan_project_dependencies failed', err);
    } finally {
      setOverviewScanning(false);
    }
  }, [overviewScanning, setOverviewScanning, patchOverviewScan]);

  const openDetailProject = useMemo(
    () =>
      detail ? (overview?.projects.find((p) => p.service_id === detail.serviceId) ?? null) : null,
    [detail, overview],
  );

  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const stats = useMemo(() => {
    let running = 0,
      starting = 0,
      stopped = 0,
      failed = 0;
    for (const svc of services) {
      const st: Status = statuses[svc.id]?.status ?? 'stopped';
      if (st === 'running') running++;
      else if (st === 'starting' || st === 'stopping') starting++;
      else if (st === 'crashed' || st === 'exited') failed++;
      else stopped++;
    }
    return { running, starting, stopped, failed };
  }, [services, statuses]);

  // Two related memos derived from the same status sweep — kept
  // separate because they have different change cadences: the Set is
  // only used by the heatmap (cheap), the aggregates are read by the
  // header on every resource tick (hot path).
  const runningServiceIds = useMemo(() => {
    const out = new Set<string>();
    for (const svc of services) {
      const st = statuses[svc.id]?.status ?? 'stopped';
      if (st === 'running' || st === 'starting') out.add(svc.id);
    }
    return out;
  }, [services, statuses]);

  // Portfolio-wide resource totals — feeds the header aggregate line
  // ("· 3.4 GB · 42% CPU"). Sums across *running* projects only so
  // stale samples from crashed processes don't inflate the numbers.
  const totals = useMemo(() => {
    let cpu = 0;
    let mem = 0;
    for (const id of runningServiceIds) {
      const s = resources[id];
      if (!s) continue;
      cpu += s.cpu_percent;
      mem += s.memory_bytes;
    }
    return { cpu, mem };
  }, [runningServiceIds, resources]);

  const total = services.length;

  const gitStats = useMemo(() => {
    let dirty = 0,
      clean = 0,
      ahead = 0,
      behind = 0,
      noUpstream = 0;
    for (const svc of services) {
      const g = git[svc.id];
      if (g === null || g === undefined) continue;
      if (g.is_dirty) dirty++;
      else clean++;
      if (g.ahead > 0) ahead++;
      if (g.behind > 0) behind++;
      if (!g.upstream) noUpstream++;
    }
    return { dirty, clean, ahead, behind, noUpstream };
  }, [services, git]);

  const gitFilterFn = useMemo(() => {
    if (gitFilter === 'all') return (_svc: ServiceDef, _g: GitStatus | null | undefined) => true;
    const fn: Record<string, (_svc: ServiceDef, g: GitStatus | null | undefined) => boolean> = {
      dirty: (_s, g) => g !== null && g !== undefined && g.is_dirty,
      clean: (_s, g) => g !== null && g !== undefined && !g.is_dirty,
      ahead: (_s, g) => g !== null && g !== undefined && g.ahead > 0,
      behind: (_s, g) => g !== null && g !== undefined && g.behind > 0,
      'no-upstream': (_s, g) => g !== null && g !== undefined && !g.upstream,
    };
    return fn[gitFilter] ?? (() => true);
  }, [gitFilter]);

  // Aggregate attention metrics — feeds both the KPI strip and the
  // secondary filter pills. One pass over `overview.projects` so we
  // never recompute inside the JSX tree. Returns `null` before the
  // first overview poll lands (prevents flashing "0 CVE" while data
  // is still loading).
  //
  // `hasDepScan` is separate from "overview exists" because git/stale
  // data is always live, while audit/outdated requires an explicit
  // scan. Tiles use this to choose between *no-data* (em-dash) and
  // *zero-data* (grey 0) rendering.
  const attentionStats = useMemo(() => {
    if (!overview) return null;
    let stale = 0;
    let dirty = 0;
    let riskProjects = 0;
    let outdatedProjects = 0;
    let cveCritical = 0;
    let cveHigh = 0;
    let cveMedium = 0;
    let cveLow = 0;
    let outdatedPackages = 0;
    for (const p of overview.projects) {
      if (p.is_stale) stale++;
      if (p.git_status?.is_dirty) dirty++;
      const critical = p.audit?.critical ?? 0;
      const high = p.audit?.high ?? 0;
      const medium = p.audit?.medium ?? 0;
      const low = p.audit?.low ?? 0;
      if (critical + high > 0) riskProjects++;
      cveCritical += critical;
      cveHigh += high;
      cveMedium += medium;
      cveLow += low;
      const outTotal = p.outdated?.total ?? 0;
      if (outTotal > 0) outdatedProjects++;
      outdatedPackages += outTotal;
    }
    return {
      stale,
      dirty,
      risk: riskProjects,
      outdated: outdatedProjects,
      cveCritical,
      cveHigh,
      cveMedium,
      cveLow,
      outdatedPackages,
      hasDepScan: overview.has_dependency_scan,
    };
  }, [overview]);

  const attentionFilterFn = useCallback(
    (svc: ServiceDef): boolean => {
      if (attentionFilter === 'all') return true;
      const meta = projectMetaById.get(svc.id);
      if (!meta) return false;
      switch (attentionFilter) {
        case 'stale':
          return meta.is_stale;
        case 'risk':
          return (meta.audit?.critical ?? 0) + (meta.audit?.high ?? 0) > 0;
        case 'outdated':
          return (meta.outdated?.total ?? 0) > 0;
        default:
          return true;
      }
    },
    [attentionFilter, projectMetaById],
  );

  const eligibleServices = useMemo(() => {
    const stackServiceIds = new Set(stacks.flatMap((st) => st.service_ids));
    return services.filter(
      (svc) =>
        !stackServiceIds.has(svc.id) && gitFilterFn(svc, git[svc.id]) && attentionFilterFn(svc),
    );
  }, [services, stacks, gitFilterFn, git, attentionFilterFn]);

  /**
   * Build a comparator for the current sort axis.
   *
   * Always falls back to `name` as a secondary key so ties (e.g. two
   * projects both with zero CVEs, both idle) have a deterministic
   * order — otherwise React's keyed reconciliation ping-pongs cards
   * on every render.
   *
   * For resource axes, non-running projects are pushed to the bottom
   * (their sample is either zero or stale) rather than sprinkling
   * them between running ones — the user asked "who's hottest", a
   * dormant project isn't an answer to that question.
   */
  const comparator = useMemo(() => {
    const byName = (a: ServiceDef, b: ServiceDef) => a.name.localeCompare(b.name);
    switch (sortBy) {
      case 'name':
        return byName;
      case 'activity':
        return (a: ServiceDef, b: ServiceDef) => {
          const ma = projectMetaById.get(a.id)?.last_activity;
          const mb = projectMetaById.get(b.id)?.last_activity;
          const ta = ma ? new Date(ma).getTime() : 0;
          const tb = mb ? new Date(mb).getTime() : 0;
          if (tb !== ta) return tb - ta;
          return byName(a, b);
        };
      case 'risk':
        return (a: ServiceDef, b: ServiceDef) => {
          const ra = riskScore(projectMetaById.get(a.id));
          const rb = riskScore(projectMetaById.get(b.id));
          if (rb !== ra) return rb - ra;
          return byName(a, b);
        };
      case 'memory':
        return (a: ServiceDef, b: ServiceDef) => {
          const ma = runningServiceIds.has(a.id) ? (resources[a.id]?.memory_bytes ?? 0) : -1;
          const mb = runningServiceIds.has(b.id) ? (resources[b.id]?.memory_bytes ?? 0) : -1;
          if (mb !== ma) return mb - ma;
          return byName(a, b);
        };
      case 'cpu':
        return (a: ServiceDef, b: ServiceDef) => {
          const ca = runningServiceIds.has(a.id) ? (resources[a.id]?.cpu_percent ?? 0) : -1;
          const cb = runningServiceIds.has(b.id) ? (resources[b.id]?.cpu_percent ?? 0) : -1;
          if (cb !== ca) return cb - ca;
          return byName(a, b);
        };
      default:
        return byName;
    }
  }, [sortBy, projectMetaById, runningServiceIds, resources]);

  // Sorted copy of the ungrouped roster (used only when
  // `groupBy === 'none'` and there are no section buckets). Grouped
  // code paths sort inside each group via the same `comparator`.
  const sortedEligibleServices = useMemo(
    () => [...eligibleServices].sort(comparator),
    [eligibleServices, comparator],
  );

  const groups = useMemo<DashGroup[]>(() => {
    if (groupBy === 'none') {
      if (sections.length === 0) return [];
      const bySection = new Map<SectionId, ServiceDef[]>();
      const validIds = new Set(sections.map((s) => s.id));
      for (const svc of eligibleServices) {
        const assigned = serviceSection[svc.id];
        const key = assigned && validIds.has(assigned) ? assigned : UNASSIGNED;
        const bucket = bySection.get(key);
        if (bucket) bucket.push(svc);
        else bySection.set(key, [svc]);
      }
      for (const list of bySection.values()) list.sort(comparator);
      const result: DashGroup[] = [];
      for (const sec of sections) {
        const svcs = bySection.get(sec.id);
        if (svcs && svcs.length > 0) {
          const meta = sectionColor(sec.color);
          result.push({
            key: sec.id,
            label: sec.name,
            dotStyle: { backgroundColor: meta.solid },
            labelStyle: { color: meta.solid },
            services: svcs,
          });
        }
      }
      const unassigned = bySection.get(UNASSIGNED);
      if (unassigned && unassigned.length > 0) {
        result.push({ key: UNASSIGNED, label: 'Unassigned', services: unassigned });
      }
      return result;
    }

    if (groupBy === 'status') {
      const running: ServiceDef[] = [];
      const stopped: ServiceDef[] = [];
      for (const svc of eligibleServices) {
        const st: Status = statuses[svc.id]?.status ?? 'stopped';
        if (st === 'running' || st === 'starting') running.push(svc);
        else stopped.push(svc);
      }
      running.sort(comparator);
      stopped.sort(comparator);
      const out: DashGroup[] = [];
      if (running.length > 0)
        out.push({
          key: 'running',
          label: 'Running',
          dotClass: 'bg-status-running',
          labelClass: 'text-status-running',
          services: running,
        });
      if (stopped.length > 0)
        out.push({
          key: 'stopped',
          label: 'Stopped',
          dotClass: 'bg-fg-dim/50',
          labelClass: 'text-fg-dim',
          services: stopped,
        });
      return out;
    }

    if (groupBy === 'runtime') {
      const byKey = new Map<string, DashGroup>();
      for (const svc of eligibleServices) {
        const rt = runtimeFromTags(svc.tags) ?? inferRuntimeFromCmds(svc.cmds) ?? 'other';
        const meta = runtimeMeta(rt);
        let group = byKey.get(rt);
        if (!group) {
          group = { key: rt, label: meta.label, labelClass: meta.color, services: [] };
          byKey.set(rt, group);
        }
        group.services.push(svc);
      }
      for (const g of byKey.values()) g.services.sort(comparator);
      const order = new Map<string, number>();
      RUNTIMES.forEach((r, i) => order.set(r.key, i));
      return [...byKey.values()].sort(
        (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
      );
    }

    const byKey = new Map<string, DashGroup>();
    for (const svc of eligibleServices) {
      const c = categoryForTags(svc.tags);
      let group = byKey.get(c.key);
      if (!group) {
        group = { key: c.key, label: c.label, dotClass: c.dot, labelClass: c.color, services: [] };
        byKey.set(c.key, group);
      }
      group.services.push(svc);
    }
    for (const g of byKey.values()) g.services.sort(comparator);
    const order = new Map<string, number>();
    CATEGORIES.forEach((c, i) => order.set(c.key, i));
    return [...byKey.values()].sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
    );
  }, [eligibleServices, groupBy, statuses, sections, serviceSection, comparator]);

  if (total === 0) {
    return (
      <div className="bg-surface relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(600px 400px at 50% 30%, rgb(var(--accent) / 0.06), transparent 70%)',
            }}
          />
          <div className="glass animate-fade-in relative max-w-sm p-8 text-center">
            <div className="bg-accent/10 border-accent/30 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border">
              <Zap className="text-accent h-7 w-7" />
            </div>
            <h2 className="text-fg text-xl font-semibold tracking-tight">Ready when you are</h2>
            <p className="text-fg-muted mt-2 text-[13px] leading-relaxed">
              Point RunHQ at a project folder to auto-detect scripts, or add your first service
              manually.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FolderSearch className="h-4 w-4" />}
                onClick={onScan}
              >
                Scan Projects
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => openEditor(null)}
              >
                Add service{' '}
                <Kbd className="ml-1.5 border-transparent bg-white/20 text-white/90">
                  {modChord('N')}
                </Kbd>
              </Button>
            </div>
          </div>
        </div>
        <aside className="relative hidden h-full min-h-0 shrink-0 xl:flex xl:flex-col">
          <ActivityTimeline variant="inline" />
        </aside>
      </div>
    );
  }

  const hasRunning = stats.running > 0;

  return (
    <div className="bg-surface relative flex min-h-0 flex-1 overflow-hidden">
      {/*
        Main column holds the scrolling dashboard. The detail drawer is
        rendered at the *root* level (below) with `absolute inset-0` so
        it spans main column + activity panel together — otherwise the
        activity panel squeezes against the drawer's right edge and the
        two visually fight for the same "right side" space.
        The overflow-hidden here guarantees card scroll doesn't bleed
        past the column and behind a potential drawer backdrop.
      */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex-1 overflow-y-auto">
          {hasRunning && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
              style={{
                background:
                  'radial-gradient(900px 340px at 50% -20%, rgb(var(--accent) / 0.09), transparent 70%)',
              }}
            />
          )}

          <div className="@container/main relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
            <header className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end @3xl/main:justify-between">
              <div>
                <div className="text-fg-dim mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase">
                  <span className="from-accent to-accent-hover border-accent/40 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-gradient-to-br text-white shadow-[0_2px_8px_-2px_rgb(var(--accent)/0.6)]">
                    <Zap className="h-3 w-3" />
                  </span>
                  <span className="text-fg">RunHQ</span>
                  {appVersion && (
                    <span className="text-fg-dim normal-case opacity-70">v{appVersion}</span>
                  )}
                  <span className="text-fg-dim mx-1 opacity-30">·</span>
                  <span className="text-fg-dim tracking-normal normal-case opacity-70">
                    {greeting()}
                  </span>
                </div>
                <h1 className="text-fg text-[28px] leading-tight font-semibold tracking-tight">
                  {hasRunning ? (
                    <>
                      <span className="text-status-running tabular-nums">{stats.running}</span>
                      <span className="text-fg">
                        {' '}
                        service{stats.running > 1 ? 's' : ''} running
                      </span>
                    </>
                  ) : stats.failed > 0 ? (
                    <>
                      <span className="text-status-error tabular-nums">{stats.failed}</span>
                      <span className="text-fg"> needs attention</span>
                    </>
                  ) : (
                    <span className="text-fg">All quiet</span>
                  )}
                </h1>
                <p className="text-fg-muted mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
                  <span className="tabular-nums">{total}</span> configured
                  <span className="text-fg-dim">·</span>
                  <span className="tabular-nums">{ports.length}</span> listening ports
                  {stats.running > 0 && totals.mem > 0 && (
                    <>
                      <span className="text-fg-dim">·</span>
                      <span
                        className="inline-flex items-center gap-1 tabular-nums"
                        title={`Aggregate memory across ${stats.running} running project${stats.running > 1 ? 's' : ''}`}
                      >
                        <MemoryStick className="text-fg-dim h-3 w-3" />
                        {formatBytes(totals.mem)}
                      </span>
                      <span className="text-fg-dim">·</span>
                      <span
                        className="inline-flex items-center gap-1 tabular-nums"
                        title={`Aggregate CPU across ${stats.running} running project${stats.running > 1 ? 's' : ''}`}
                      >
                        <Cpu className="text-fg-dim h-3 w-3" />
                        {formatPercent(totals.cpu)}
                      </span>
                    </>
                  )}
                  {stats.starting > 0 && (
                    <>
                      <span className="text-fg-dim">·</span>
                      <span className="text-status-starting inline-flex items-center gap-1 tabular-nums">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {stats.starting} starting
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lastScanAt != null && !overviewScanning && (
                  <span
                    className="text-fg-dim text-[11px] tabular-nums"
                    title={`Dependency scan completed ${new Date(lastScanAt).toLocaleString()}`}
                  >
                    {scanFreshnessLabel(lastScanAt, now)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void runScan()}
                  disabled={overviewScanning || !overview}
                  className={cn(
                    'text-fg-dim hover:text-fg hover:bg-surface-muted/60 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-medium transition',
                    overviewScanning && 'cursor-not-allowed opacity-60',
                    // Pulse the scan button when data is >30 minutes old so
                    // the user gets a gentle nudge to rescan before making
                    // decisions off stale numbers.
                    lastScanAt != null &&
                      !overviewScanning &&
                      now - lastScanAt > 30 * 60_000 &&
                      'text-orange-300 hover:text-orange-200',
                  )}
                  title={
                    overview?.has_dependency_scan
                      ? 'Re-run npm outdated / cargo audit across all projects'
                      : 'Run npm outdated / cargo audit across all projects'
                  }
                >
                  {overviewScanning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : overview?.has_dependency_scan ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {overviewScanning
                    ? 'Scanning…'
                    : overview?.has_dependency_scan
                      ? 'Rescan deps'
                      : 'Scan deps'}
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FolderSearch className="h-4 w-4" />}
                  onClick={onScan}
                >
                  Scan Projects
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Layers className="h-4 w-4" />}
                  onClick={() => openStackEditor(null)}
                >
                  New stack
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => openEditor(null)}
                >
                  New service
                </Button>
              </div>
            </header>

            {/*
            Process-state and health-debt tiles used to sit here as two
            4-up grids (Running/Starting/Stopped/Failed + CVE/Outdated/
            Stale/Dirty). They were dropped because every signal they
            carried is surfaced more densely elsewhere — process state
            in the page header's summary line ("N running · M starting"),
            health debt as clickable chips in the filter bar below, and
            the actual outliers in the WorstOffenders band. Keeping the
            tiles burned ~200px of vertical real estate to show mostly
            zeros on a calm day, pushing the real work (project cards)
            below the fold.
          */}

            {overview && overview.projects.length > 0 && (
              <WorstOffenders projects={overview.projects} onOpenDetail={openDetail} limit={5} />
            )}

            {/*
            Resource heatmap — ROADMAP §1 "which projects are burning
            most RAM/CPU?". Only rendered when there's at least one
            running sample; sits below the health bands so the reading
            order is: health → risk → load.
          */}
            {stats.running > 0 && (
              <ResourceHeatmap
                services={services}
                resources={resources}
                runningIds={runningServiceIds}
                onJump={(id) => useAppStore.getState().setSelected(id)}
                limit={5}
              />
            )}

            {/*
            Card controls bar — sits immediately above the roster and
            owns every control that rearranges or filters it.
            Reading order (left → right): organize (Group / Sort), then
            filter (Git, Attention). Group/Sort are always present so
            the user has a stable mental model; Git/Attention pills
            only appear when there's data to filter on, otherwise
            they'd be noise.
          */}
            {/*
            Each logical cluster — Organize · Git · Attention — is a
            single flex child so its label stays glued to its pills and
            the group reads as one unit. Between clusters we use a
            larger `gap-x-5` + a vertical divider so the eye sees three
            distinct "chambers" on a single row, not a flat stream of
            controls. Within a cluster, gaps are deliberately tighter
            (gap-2 / gap-1) to amplify the same contrast.
          */}
            <div className="glass flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
              <FilterGroup>
                <Select
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as DashboardGroupBy)}
                  options={GROUP_OPTIONS.map((o) => ({
                    value: o.key,
                    label: o.label,
                    description: o.description,
                  }))}
                  ariaLabel="Group cards by"
                  leading={<Layers size={11} />}
                />
                <Select
                  value={sortBy}
                  onChange={(v) => setSortBy(v as DashboardSortBy)}
                  options={SORT_OPTIONS.map((o) => ({
                    value: o.key,
                    label: o.label,
                    description: o.description,
                  }))}
                  ariaLabel="Sort cards by"
                  leading={<ArrowDownWideNarrow size={11} />}
                />
              </FilterGroup>

              {gitStats.dirty + gitStats.clean > 0 && (
                <>
                  <GroupDivider />
                  <FilterGroup label="Git" icon={<GitBranch className="text-fg-dim h-3.5 w-3.5" />}>
                    <FilterPill
                      active={gitFilter === 'all'}
                      onClick={() => setGitFilter('all')}
                      label="All"
                      count={gitStats.dirty + gitStats.clean}
                    />
                    <FilterPill
                      active={gitFilter === 'dirty'}
                      onClick={() => setGitFilter('dirty')}
                      label="Dirty"
                      count={gitStats.dirty}
                      tone="dirty"
                    />
                    <FilterPill
                      active={gitFilter === 'clean'}
                      onClick={() => setGitFilter('clean')}
                      label="Clean"
                      count={gitStats.clean}
                      tone="clean"
                    />
                    <FilterPill
                      active={gitFilter === 'ahead'}
                      onClick={() => setGitFilter('ahead')}
                      label="Ahead"
                      count={gitStats.ahead}
                    />
                    <FilterPill
                      active={gitFilter === 'behind'}
                      onClick={() => setGitFilter('behind')}
                      label="Behind"
                      count={gitStats.behind}
                    />
                    <FilterPill
                      active={gitFilter === 'no-upstream'}
                      onClick={() => setGitFilter('no-upstream')}
                      label="No upstream"
                      count={gitStats.noUpstream}
                    />
                  </FilterGroup>
                </>
              )}

              {attentionStats &&
                attentionStats.stale + attentionStats.risk + attentionStats.outdated > 0 && (
                  <>
                    <GroupDivider />
                    <FilterGroup
                      label="Attention"
                      icon={<AlertTriangle className="text-fg-dim h-3.5 w-3.5" />}
                    >
                      {attentionStats.stale > 0 && (
                        <FilterPill
                          active={attentionFilter === 'stale'}
                          onClick={() =>
                            setAttentionFilter((a) => (a === 'stale' ? 'all' : 'stale'))
                          }
                          label="Stale"
                          count={attentionStats.stale}
                          icon={<Clock className="h-3 w-3" />}
                        />
                      )}
                      {attentionStats.risk > 0 && (
                        <FilterPill
                          active={attentionFilter === 'risk'}
                          onClick={() => setAttentionFilter((a) => (a === 'risk' ? 'all' : 'risk'))}
                          label="Risk"
                          count={attentionStats.risk}
                          tone="risk"
                          icon={<ShieldAlert className="h-3 w-3" />}
                        />
                      )}
                      {attentionStats.outdated > 0 && (
                        <FilterPill
                          active={attentionFilter === 'outdated'}
                          onClick={() =>
                            setAttentionFilter((a) => (a === 'outdated' ? 'all' : 'outdated'))
                          }
                          label="Outdated"
                          count={attentionStats.outdated}
                          tone="outdated"
                          icon={<Package className="h-3 w-3" />}
                        />
                      )}
                    </FilterGroup>
                  </>
                )}
            </div>

            {stacks.map((stack) => {
              const stackServices = stack.service_ids
                .map((sid) => services.find((s) => s.id === sid))
                .filter(
                  (svc): svc is ServiceDef =>
                    !!svc && gitFilterFn(svc, git[svc.id]) && attentionFilterFn(svc),
                );
              const runningCount = stackServices.filter(
                (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
              ).length;
              const anyRunning = runningCount > 0;
              return (
                <section
                  key={stack.id}
                  className="group/section"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const svcId = e.dataTransfer.getData('application/x-service-id');
                    if (!svcId || stack.service_ids.includes(svcId)) return;
                    const updated = { ...stack, service_ids: [...stack.service_ids, svcId] };
                    await ipc.updateStack(updated);
                    upsertStack(updated);
                  }}
                >
                  <SectionHeader
                    icon={<Layers className="h-3.5 w-3.5" />}
                    label={stack.name}
                    tone="accent"
                    count={stackServices.length}
                    runningCount={runningCount}
                    onClick={() => setSelectedStack(stack.id)}
                    actions={
                      <>
                        {anyRunning ? (
                          <HeaderAction
                            title="Stop all"
                            onClick={() => void ipc.stopStack(stack.id)}
                            tone="danger"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </HeaderAction>
                        ) : (
                          <HeaderAction
                            title="Start all"
                            onClick={() => void ipc.startStack(stack.id)}
                            tone="run"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </HeaderAction>
                        )}
                        <HeaderAction
                          title="Restart all"
                          onClick={() => void ipc.restartStack(stack.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </HeaderAction>
                        <HeaderAction title="Edit stack" onClick={() => openStackEditor(stack)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </HeaderAction>
                        <HeaderAction
                          title="Delete stack"
                          tone="danger"
                          onClick={() => {
                            setPendingConfirm({
                              message: `Delete stack "${stack.name}"?`,
                              onConfirm: async () => {
                                setPendingConfirm(null);
                                await ipc.removeStack(stack.id);
                                removeStack(stack.id);
                              },
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </HeaderAction>
                      </>
                    }
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                    {stackServices.map((svc) => (
                      <ServiceCard
                        key={svc.id}
                        svc={svc}
                        projectMeta={projectMetaById.get(svc.id) ?? null}
                        onOpenDetail={openDetail}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {groups.length > 0
              ? groups.map((group) => {
                  const runningInGroup = group.services.filter(
                    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
                  ).length;
                  return (
                    <section key={group.key} className="group/section">
                      <SectionHeader
                        dotClass={group.dotClass}
                        dotStyle={group.dotStyle}
                        label={group.label}
                        labelClass={group.labelClass}
                        labelStyle={group.labelStyle}
                        count={group.services.length}
                        runningCount={runningInGroup}
                      />
                      <div className="mt-3 grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                        {group.services.map((svc) => (
                          <ServiceCard
                            key={svc.id}
                            svc={svc}
                            draggable
                            projectMeta={projectMetaById.get(svc.id) ?? null}
                            onOpenDetail={openDetail}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })
              : sortedEligibleServices.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                    {sortedEligibleServices.map((svc) => (
                      <ServiceCard
                        key={svc.id}
                        svc={svc}
                        draggable
                        projectMeta={projectMetaById.get(svc.id) ?? null}
                        onOpenDetail={openDetail}
                      />
                    ))}
                  </div>
                )}

            <footer className="text-fg-dim mt-auto flex items-center justify-between pt-4 text-[11px]">
              <span>Everything runs locally. No telemetry.</span>
              <span className="flex items-center gap-1.5 opacity-70">
                <Kbd>{modChord('K')}</Kbd>
                <span>quick jump</span>
              </span>
            </footer>
          </div>
          {pendingConfirm && (
            <ConfirmDialog
              message={pendingConfirm.message}
              onConfirm={pendingConfirm.onConfirm}
              onCancel={() => setPendingConfirm(null)}
            />
          )}
        </div>
      </div>
      <aside className="relative hidden h-full min-h-0 shrink-0 xl:flex xl:flex-col">
        <ActivityTimeline variant="inline" />
      </aside>
      {openDetailProject && detail && (
        <ProjectDetailDrawer
          project={openDetailProject}
          initialTab={detail.tab}
          scanning={overviewScanning}
          lastScanAt={lastScanAt}
          onRescan={() => void runScan()}
          onClose={closeDetail}
          onJump={(id) => {
            closeDetail();
            useAppStore.getState().setSelected(id);
          }}
          editors={editors}
          onOpenPath={(path) => void ipc.openPath(path)}
          onOpenInEditor={async (command, path) => {
            try {
              await ipc.openInEditor(command, path);
            } catch {
              // Fallback so the click is never a dead-end — if the editor
              // binary can't be spawned (uninstalled, path changed,
              // permission denied), surface the folder in the OS file
              // manager instead of silently failing.
              void ipc.openPath(path);
            }
          }}
          onOpenUrl={(url) => void ipc.openUrl(url)}
        />
      )}
    </div>
  );
}

/**
 * Chamber wrapper for one cluster of filter-bar controls (e.g. the Git
 * pill group, or the Organize selects). Keeps label + children glued
 * together so the row reads as {Organize} · {Git} · {Attention}
 * instead of a flat stream where the eye can't tell where one group
 * ends and the next begins.
 */
function FilterGroup({
  label,
  icon,
  children,
}: {
  label?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {(icon || label) && (
        <div className="flex items-center gap-1.5">
          {icon}
          {label && (
            <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
              {label}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

/** Vertical rule between filter chambers. */
function GroupDivider() {
  return <span aria-hidden className="bg-border/70 h-4 w-px shrink-0" />;
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  tone,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'dirty' | 'clean' | 'risk' | 'outdated';
  icon?: React.ReactNode;
}) {
  const activeTone =
    tone === 'dirty'
      ? 'bg-status-starting/20 text-status-starting'
      : tone === 'clean'
        ? 'bg-status-running/20 text-status-running'
        : tone === 'risk'
          ? 'bg-status-error/20 text-status-error'
          : tone === 'outdated'
            ? 'bg-orange-500/20 text-orange-300'
            : 'bg-accent/15 text-accent';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-app-sm inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold transition',
        active ? activeTone : 'text-fg-dim hover:text-fg hover:bg-surface-muted/60',
      )}
    >
      {icon}
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
