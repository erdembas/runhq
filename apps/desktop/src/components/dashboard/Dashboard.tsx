import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ChevronDown,
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
import { DashboardSkeleton } from './DashboardSkeleton';
import { WorstOffenders } from './WorstOffenders';
import { buildWorkspaceFacts } from '@/lib/ai/workspaceSummary';
import { buildWorkspaceReportChatPayload } from '@/lib/ai/workspaceReportPayload';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { riskScore } from '@/lib/risk';
import { ResourceHeatmap } from './ResourceHeatmap';
import { SectionHeader, HeaderAction } from './SectionHeader';

interface Props {
  onScan: () => void;
}

/**
 * "Rescan recommended" threshold. Mirrors `SCAN_STALE_MS` inside
 * ServiceCard — a >7d-old scan is the dashboard-level definition of
 * stale. Hoisted here (rather than imported) so the Dashboard
 * module doesn't reach into a card-level helper just for a number.
 * If either surface moves, both should agree on the new value.
 */
const STALE_SCAN_THRESHOLD_MS = 7 * 24 * 60 * 60_000;

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

/**
 * Tone vocabulary shared between the hero headline, the ambient
 * backdrop gradient, and (eventually) the OS dock badge. Matches the
 * semantic palette in `tailwind.config` so any consumer can derive
 * the right colour tokens by switching on this enum alone.
 */
type WorkspaceTone = 'critical' | 'warning' | 'running' | 'idle';

interface HeroState {
  /**
   * Numeric "lead" displayed in tabular numerals when defined. Kept
   * separate from `label` so the count can render in the tone colour
   * while the rest of the headline stays neutral.
   */
  count?: number;
  /** Plain-text body that follows the count (e.g. "services running"). */
  label: string;
  tone: WorkspaceTone;
}

/**
 * Pick the single most important state to feature in the dashboard
 * hero. Strict priority order — never compose ("3 running, 2 failing"
 * crowds the eye and dilutes severity). The user can always read the
 * full breakdown in the chips and offender band below.
 *
 * Ordering rationale:
 *   1. failures   → ship-tonight signal, takes precedence even if other
 *                   services are happily running.
 *   2. critical CVE → security debt, beats "outdated" because patching
 *                     a critical CVE is non-deferrable.
 *   3. running    → positive state worth surfacing when there's no
 *                   active fire, gives a sense of "things are alive".
 *   4. outdated   → maintenance debt, deferrable but accumulating.
 *   5. idle fallback.
 */
function deriveHeroState(
  stats: { running: number; failed: number; starting: number },
  attention: { cveCritical: number; outdated: number } | null,
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

/**
 * Tailwind class fragments for each tone. Centralised here so the
 * count colour, the ambient backdrop, and the small status dot all
 * stay in lock-step — change the palette in one place.
 */
const TONE_CLASSES: Record<WorkspaceTone, { count: string; dot: string; backdrop: string | null }> =
  {
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
      // Idle deliberately renders no backdrop — the cleanest possible
      // surface signals "nothing demands your attention right now"
      // better than any subtle gradient could.
      backdrop: null,
    },
  };

export function Dashboard({ onScan }: Props) {
  const services = useAppStore((s) => s.services);
  const servicesLoaded = useAppStore((s) => s.servicesLoaded);
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
  const patchScanEntry = useAppStore((s) => s.patchScanEntry);
  const setScanningService = useAppStore((s) => s.setScanningService);
  const scanFreshnessByService = useAppStore((s) => s.scanFreshnessByService);
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

  /**
   * Roster of services whose persisted scan is older than 7 days
   * (or has no persisted scan yet despite having a runtime that
   * scanners actually touch — those are arguably the most stale of
   * all). Drives the visibility + behaviour of "Rescan stale".
   */
  const staleScanServiceIds = useMemo(() => {
    const ids: string[] = [];
    for (const svc of services) {
      const meta = projectMetaById.get(svc.id);
      // Only meaningful for projects with a detected runtime — pure
      // docker-compose stacks have nothing to scan, so they
      // shouldn't be in the "stale scans" tally.
      if (!meta?.runtime) continue;
      const stamped = scanFreshnessByService.get(svc.id);
      if (stamped == null || now - stamped >= STALE_SCAN_THRESHOLD_MS) {
        ids.push(svc.id);
      }
    }
    return ids;
  }, [services, projectMetaById, scanFreshnessByService, now]);

  /**
   * Rescan only the projects whose persisted scan is past the stale
   * threshold. Walks them sequentially with a tiny delay between
   * IPC calls so we don't blast 30 parallel `npm outdated`
   * subprocesses through Tauri's IPC bridge — the batch endpoint
   * already does that better. Sequential per-service is the
   * "incremental refresh" mode: spinner ticks across cards, the
   * user sees progress, and we never block the UI for the full
   * duration.
   */
  const runStaleRescan = useCallback(async () => {
    if (overviewScanning) return;
    if (staleScanServiceIds.length === 0) return;
    for (const id of staleScanServiceIds) {
      setScanningService(id, true);
      try {
        const entry = await ipc.scanProjectDependencyForService(id, true);
        patchScanEntry(entry);
      } catch (err) {
        console.warn('[Dashboard] stale rescan failed', { serviceId: id, err });
      } finally {
        setScanningService(id, false);
      }
    }
  }, [staleScanServiceIds, setScanningService, patchScanEntry, overviewScanning]);

  const openDetailProject = useMemo(
    () =>
      detail ? (overview?.projects.find((p) => p.service_id === detail.serviceId) ?? null) : null,
    [detail, overview],
  );

  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  /**
   * Open a workspace-report conversation in the right-side chat hub.
   *
   * Pre-Phase 6 this lived in a dedicated `AiWorkspaceReportDialog` —
   * the dialog mounted its own stream + copy buttons. Routing through
   * `openAiChat` instead means the user picks the model, the report
   * persists to History, and follow-up questions ("ok, what about
   * the staging cluster only?") work without a new surface.
   *
   * We snapshot the dashboard state at click-time, not on every
   * render, so the model gets a consistent view and a regenerate
   * compares apples to apples — sampling per-render would mean the
   * running CPU figure shifts under the model mid-stream.
   */
  // We snapshot dashboard state inside `buildPayload` (called by
  // the hook at click-time) instead of capturing it in a useCallback
  // dep — same effect, but the hook handles the popover wiring.
  const {
    triggerRef: workspaceReportTriggerRef,
    onClick: launchWorkspaceReport,
    popover: workspaceReportPopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const facts = buildWorkspaceFacts({
        services,
        statuses,
        resources,
        git,
        listening_port_count: ports.length,
        overview,
      });
      const payload = buildWorkspaceReportChatPayload(facts);
      return {
        origin: 'dashboard_report',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

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

  // Cold-start guard: the IPC roster fetch hasn't resolved yet, so
  // we don't actually know whether the user has zero services or a
  // hundred. Render the skeleton instead of either branch below —
  // a 200-400ms flash of "Ready when you are" on every launch is a
  // confidence-eroder for users who definitely *do* have projects
  // configured. Once `setServices` fires (even with an empty array)
  // we move on to the real branches.
  if (!servicesLoaded) {
    return <DashboardSkeleton />;
  }

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
                title="Walk known parent folders looking for new project directories"
              >
                Discover projects
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
      </div>
    );
  }

  const heroState = deriveHeroState(stats, attentionStats);
  const heroTone = TONE_CLASSES[heroState.tone];

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
          {/*
            Ambient backdrop reflects the workspace's current tone —
            green when projects are running, amber on accumulating
            outdated debt, red on failures or critical CVEs, no
            gradient at all on idle. Previously we always rendered an
            accent-orange glow regardless of state, which read as
            "everything is fine" even when the chips below screamed
            otherwise. State-derived colour eliminates that mismatch.
          */}
          {heroTone.backdrop && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
              style={{
                background: `radial-gradient(900px 340px at 50% -20%, ${heroTone.backdrop}, transparent 70%)`,
              }}
            />
          )}

          <div className="@container/main relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
            {/*
              Hero block — three reading layers:
                1. Identity strip (status dot + "Workspace · N services
                   · vX.Y" + optional "Last scan Nm ago" with inline
                   Rescan link). Subdued; this is metadata, not a
                   headline.
                2. Dynamic title surfacing the single most-pressing
                   state via `deriveHeroState`. Strict priority order
                   means the user always sees one signal, not a
                   composite "3 running, 2 failing, 1 outdated"
                   tableau that dilutes everything.
                3. Right-aligned action cluster collapsed to one
                   primary ("New service") + one overflow menu —
                   replaces the previous three-button row that gave
                   create/grow/scan/analyze CTAs equal weight.
            */}
            <header className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-start @3xl/main:justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-fg-dim mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn('h-2 w-2 rounded-full', heroTone.dot)} />
                    <span className="text-fg-muted font-semibold tracking-[0.14em] uppercase">
                      Workspace
                    </span>
                  </span>
                  <span className="text-fg-dim/40">·</span>
                  <span>
                    <span className="tabular-nums">{total}</span> service{total === 1 ? '' : 's'}
                  </span>
                  {appVersion && (
                    <>
                      <span className="text-fg-dim/40">·</span>
                      <span className="text-fg-dim/80">v{appVersion}</span>
                    </>
                  )}
                  {lastScanAt != null && !overviewScanning && (
                    <>
                      <span className="text-fg-dim/40">·</span>
                      <span
                        title={`Dependency scan completed ${new Date(lastScanAt).toLocaleString()}`}
                      >
                        {scanFreshnessLabel(lastScanAt, now).replace('Scanned ', 'Last scan ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => void runScan()}
                        disabled={overviewScanning}
                        className="text-fg-dim hover:text-accent inline-flex items-center gap-1 transition disabled:opacity-50"
                        title="Re-run npm outdated / cargo audit across all projects"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Rescan
                      </button>
                    </>
                  )}
                  {overviewScanning && (
                    <>
                      <span className="text-fg-dim/40">·</span>
                      <span className="text-fg-muted inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Scanning…
                      </span>
                    </>
                  )}
                  {!overviewScanning &&
                    lastScanAt == null &&
                    overview &&
                    !overview.has_dependency_scan && (
                      <>
                        <span className="text-fg-dim/40">·</span>
                        <button
                          type="button"
                          onClick={() => void runScan()}
                          className="text-fg-dim hover:text-accent inline-flex items-center gap-1 transition"
                          title="Run npm outdated / cargo audit across all projects"
                        >
                          <Sparkles className="h-3 w-3" />
                          Run first scan
                        </button>
                      </>
                    )}
                  {staleScanServiceIds.length > 0 && !overviewScanning && (
                    <>
                      <span className="text-fg-dim/40">·</span>
                      <button
                        type="button"
                        onClick={() => void runStaleRescan()}
                        className="border-tone-warning/30 bg-tone-warning-bg/25 text-tone-warning-fg hover:bg-tone-warning-bg/45 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition"
                        title={`${staleScanServiceIds.length} project${
                          staleScanServiceIds.length === 1 ? '' : 's'
                        } not scanned in 7+ days — click to rescan only the stale ones`}
                      >
                        <span className="bg-tone-warning/70 inline-block h-1.5 w-1.5 rounded-full" />
                        {staleScanServiceIds.length} stale
                      </button>
                    </>
                  )}
                </div>
                <h1 className="text-fg text-[32px] leading-[1.1] font-semibold tracking-tight">
                  {heroState.count != null ? (
                    <>
                      <span className={cn('tabular-nums', heroTone.count)}>{heroState.count}</span>
                      <span className="text-fg"> {heroState.label}</span>
                    </>
                  ) : (
                    <span className={cn(heroTone.count)}>{heroState.label}</span>
                  )}
                </h1>
                {(stats.running > 0 || stats.starting > 0 || ports.length > 0) && (
                  <p className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    {stats.running > 0 && totals.mem > 0 && (
                      <>
                        <span
                          className="inline-flex items-center gap-1 tabular-nums"
                          title={`Aggregate memory across ${stats.running} running project${stats.running > 1 ? 's' : ''}`}
                        >
                          <MemoryStick className="text-fg-dim h-3 w-3" />
                          {formatBytes(totals.mem)}
                        </span>
                        <span className="text-fg-dim/50">·</span>
                        <span
                          className="inline-flex items-center gap-1 tabular-nums"
                          title={`Aggregate CPU across ${stats.running} running project${stats.running > 1 ? 's' : ''}`}
                        >
                          <Cpu className="text-fg-dim h-3 w-3" />
                          {formatPercent(totals.cpu)}
                        </span>
                        {(stats.starting > 0 || ports.length > 0) && (
                          <span className="text-fg-dim/50">·</span>
                        )}
                      </>
                    )}
                    {stats.starting > 0 && (
                      <>
                        <span className="text-status-starting inline-flex items-center gap-1 tabular-nums">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {stats.starting} starting
                        </span>
                        {ports.length > 0 && <span className="text-fg-dim/50">·</span>}
                      </>
                    )}
                    {ports.length > 0 && (
                      <span
                        className="tabular-nums"
                        title={`${ports.length} listening port${ports.length === 1 ? '' : 's'}`}
                      >
                        {ports.length} port{ports.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </p>
                )}
              </div>
              {/*
                Right cluster collapsed to a single primary CTA plus
                an overflow menu. Discover projects / New stack /
                Rescan deps / Analyze workspace all live in the
                dropdown — they're each used at most once a day, so
                surfacing them as full buttons stole prominence from
                the daily-driver "+ New service" without earning it.
              */}
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => openEditor(null)}
                >
                  New service
                </Button>
                <DashboardActionsMenu
                  onDiscover={onScan}
                  onNewStack={() => openStackEditor(null)}
                  onRescan={() => void runScan()}
                  onAnalyze={() => {
                    if (services.length === 0) return;
                    launchWorkspaceReport();
                  }}
                  analyzeButtonRef={workspaceReportTriggerRef}
                  disableAnalyze={services.length === 0}
                  disableRescan={overviewScanning || !overview}
                  rescanLabel={
                    overviewScanning
                      ? 'Scanning…'
                      : overview?.has_dependency_scan
                        ? 'Rescan deps'
                        : 'Scan deps'
                  }
                />
                {workspaceReportPopover}
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
              Unified FilterBar — single horizontal row of pill chips
              spanning all filterable axes (Attention + Git). Each
              group leads with an explicit "All N" reset pill so the
              user always has an unambiguous "show everything" target
              instead of having to click the active pill again to
              deactivate. Groups are visually separated by a thin
              vertical divider; on narrow widths the row wraps but
              groups stay together via `flex` siblings.

              Why merge attention + git into one row: previously they
              were two parallel surfaces (attention as chunky chips
              near the hero, git as flat pills above the roster) doing
              the same job — slicing the project list — using two
              different visual languages. Linear/Notion-style modern
              dashboards expose ALL filter axes in one cohesive bar
              so the user's mental model is "I'm filtering" rather
              than "I'm using the X widget".

              The hero's title still surfaces the most-pressing state
              ("2 critical CVEs") so severity remains visible without
              the chunky chip row at the top.

              `attentionStats` is null until the first overview poll
              lands; in that window the attention group hides
              entirely (no chrome, no count) rather than rendering
              dashed placeholders that never resolve to a value.
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {attentionStats &&
                attentionStats.stale + attentionStats.risk + attentionStats.outdated > 0 && (
                  <FilterChipGroup ariaLabel="Attention filters">
                    <FilterChip
                      active={attentionFilter === 'all'}
                      onClick={() => setAttentionFilter('all')}
                      tone="muted"
                      label="All"
                      count={total}
                      title="Show projects regardless of attention bucket"
                    />
                    {attentionStats.stale > 0 && (
                      <FilterChip
                        active={attentionFilter === 'stale'}
                        onClick={() => setAttentionFilter((a) => (a === 'stale' ? 'all' : 'stale'))}
                        tone="neutral"
                        icon={<Clock className="h-3 w-3" />}
                        label="Stale"
                        count={attentionStats.stale}
                        title={`${attentionStats.stale} project${
                          attentionStats.stale === 1 ? '' : 's'
                        } with no recent activity`}
                      />
                    )}
                    {attentionStats.risk > 0 && (
                      <FilterChip
                        active={attentionFilter === 'risk'}
                        onClick={() => setAttentionFilter((a) => (a === 'risk' ? 'all' : 'risk'))}
                        tone="critical"
                        icon={<ShieldAlert className="h-3 w-3" />}
                        label="Risk"
                        count={attentionStats.risk}
                        title={`${attentionStats.risk} project${
                          attentionStats.risk === 1 ? '' : 's'
                        } with critical or high CVEs`}
                      />
                    )}
                    {attentionStats.outdated > 0 && (
                      <FilterChip
                        active={attentionFilter === 'outdated'}
                        onClick={() =>
                          setAttentionFilter((a) => (a === 'outdated' ? 'all' : 'outdated'))
                        }
                        tone="warning"
                        icon={<Package className="h-3 w-3" />}
                        label="Outdated"
                        count={attentionStats.outdated}
                        title={`${attentionStats.outdated} project${
                          attentionStats.outdated === 1 ? '' : 's'
                        } with outdated dependencies`}
                      />
                    )}
                  </FilterChipGroup>
                )}

              {gitStats.dirty + gitStats.clean > 0 && (
                <>
                  {attentionStats &&
                    attentionStats.stale + attentionStats.risk + attentionStats.outdated > 0 && (
                      <span
                        aria-hidden
                        className="bg-border/70 mx-1 hidden h-5 w-px self-center sm:inline-block"
                      />
                    )}
                  <FilterChipGroup ariaLabel="Git filters">
                    <FilterChip
                      active={gitFilter === 'all'}
                      onClick={() => setGitFilter('all')}
                      tone="muted"
                      icon={<GitBranch className="h-3 w-3" />}
                      label="All"
                      count={gitStats.dirty + gitStats.clean}
                      title="Show projects regardless of git state"
                    />
                    {gitStats.dirty > 0 && (
                      <FilterChip
                        active={gitFilter === 'dirty'}
                        onClick={() => setGitFilter((a) => (a === 'dirty' ? 'all' : 'dirty'))}
                        tone="warning"
                        label="Dirty"
                        count={gitStats.dirty}
                        title="Projects with uncommitted changes"
                      />
                    )}
                    {gitStats.clean > 0 && (
                      <FilterChip
                        active={gitFilter === 'clean'}
                        onClick={() => setGitFilter((a) => (a === 'clean' ? 'all' : 'clean'))}
                        tone="success"
                        label="Clean"
                        count={gitStats.clean}
                        title="Projects with no uncommitted changes"
                      />
                    )}
                    {gitStats.ahead > 0 && (
                      <FilterChip
                        active={gitFilter === 'ahead'}
                        onClick={() => setGitFilter((a) => (a === 'ahead' ? 'all' : 'ahead'))}
                        tone="muted"
                        label="Ahead"
                        count={gitStats.ahead}
                        title="Projects with unpushed commits"
                      />
                    )}
                    {gitStats.behind > 0 && (
                      <FilterChip
                        active={gitFilter === 'behind'}
                        onClick={() => setGitFilter((a) => (a === 'behind' ? 'all' : 'behind'))}
                        tone="muted"
                        label="Behind"
                        count={gitStats.behind}
                        title="Projects whose remote has new commits"
                      />
                    )}
                    {gitStats.noUpstream > 0 && (
                      <FilterChip
                        active={gitFilter === 'no-upstream'}
                        onClick={() =>
                          setGitFilter((a) => (a === 'no-upstream' ? 'all' : 'no-upstream'))
                        }
                        tone="muted"
                        label="No upstream"
                        count={gitStats.noUpstream}
                        title="Projects without a tracking branch"
                      />
                    )}
                  </FilterChipGroup>
                </>
              )}

              {(gitFilter !== 'all' || attentionFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setGitFilter('all');
                    setAttentionFilter('all');
                  }}
                  className="text-fg-dim hover:text-accent inline-flex items-center gap-1 text-[11px] transition"
                  title="Reset every filter"
                >
                  Clear filters
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
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
              </div>
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
/**
 * Wraps a logical filter group (Attention, Git, …) into a single
 * inline cluster. We deliberately avoid a per-group label/header now
 * that filters share one row — the visual divider between groups
 * carries enough delineation, and a row of "ATTENTION:" "GIT:"
 * mini-titles would compete with the chip labels themselves for
 * visual real estate.
 */
function FilterChipGroup({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

/**
 * Unified filter pill used by every group on the dashboard's roster
 * filter row. Designed to read at three states unambiguously:
 *
 *   - inactive idle  → grey chrome, dim text, count visible
 *   - inactive hover → subtle lift toward the tone colour
 *   - active         → tone-tinted background + text, no extra
 *                      indicator dots needed
 *
 * `tone` semantics:
 *   - `muted`     → neutral state pill ("All", Ahead/Behind/etc) —
 *                   no severity, just an axis label
 *   - `neutral`   → "unwatched" bucket (Stale) — flat grey accent
 *   - `success`   → positive state (git Clean) — green
 *   - `warning`   → deferrable debt (Outdated, git Dirty) — amber
 *   - `critical`  → ship-tonight signal (Risk / CVE) — red
 *
 * Active styling carries enough contrast on its own that we no
 * longer need the persistent tone tint the previous `AttentionChip`
 * used: a row of always-tinted chips read as "alerts everywhere"
 * instead of "active filter here". With unification, only the
 * actively-selected chip wears its tone, mirroring Linear/Notion.
 */
type FilterChipTone = 'muted' | 'neutral' | 'success' | 'warning' | 'critical';

const FILTER_CHIP_TONES: Record<FilterChipTone, { active: string; idleHover: string }> = {
  muted: {
    active: 'border-fg-dim/40 bg-fg-dim/20 text-fg shadow-[0_0_0_1px_rgb(var(--fg)/0.10)_inset]',
    idleHover: 'hover:border-fg-dim/30 hover:bg-fg-dim/10 hover:text-fg/85',
  },
  neutral: {
    active: 'border-fg-dim/40 bg-fg-dim/20 text-fg shadow-[0_0_0_1px_rgb(var(--fg)/0.10)_inset]',
    idleHover: 'hover:border-fg-dim/30 hover:bg-fg-dim/10 hover:text-fg/85',
  },
  success: {
    active:
      'border-status-running/40 bg-status-running/18 text-status-running shadow-[0_0_0_1px_rgb(var(--status-running)/0.25)_inset]',
    idleHover:
      'hover:border-status-running/25 hover:bg-status-running/10 hover:text-status-running',
  },
  warning: {
    active:
      'border-tone-warning/45 bg-tone-warning/22 text-tone-warning-fg shadow-[0_0_0_1px_rgb(var(--tone-warning)/0.30)_inset]',
    idleHover: 'hover:border-tone-warning/30 hover:bg-tone-warning/12 hover:text-tone-warning-fg',
  },
  critical: {
    active:
      'border-tone-critical/45 bg-tone-critical/22 text-tone-critical-fg shadow-[0_0_0_1px_rgb(var(--tone-critical)/0.30)_inset]',
    idleHover:
      'hover:border-tone-critical/30 hover:bg-tone-critical/12 hover:text-tone-critical-fg',
  },
};

function FilterChip({
  active,
  onClick,
  tone,
  icon,
  label,
  count,
  title,
}: {
  active: boolean;
  onClick: () => void;
  tone: FilterChipTone;
  icon?: React.ReactNode;
  label: string;
  count: number;
  title?: string;
}) {
  const palette = FILTER_CHIP_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tabular-nums transition',
        active ? palette.active : cn('text-fg-dim border-transparent', palette.idleHover),
      )}
    >
      {icon && <span className={cn(active ? '' : 'text-fg-dim/80')}>{icon}</span>}
      <span>{label}</span>
      <span
        className={cn(
          'rounded-sm px-1 text-[10px] tabular-nums',
          active ? 'bg-black/15 dark:bg-white/15' : 'bg-fg-dim/15 text-fg-dim',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Overflow menu for the dashboard hero. Houses every workspace-level
 * action that isn't the daily-driver "+ New service" button — so the
 * primary CTA can sit alone in the prominent top-right slot without
 * three near-equal siblings stealing its weight.
 *
 * Why a hand-rolled menu (instead of pulling in @radix-ui/dropdown-menu
 * or similar): we already lean on the same click-outside + Escape
 * pattern in `ThemeMenu`/`SectionMenus`/`HistoryDrawer`; adopting it
 * here keeps the bundle lean and matches the local idiom. If a fourth
 * surface needs the same dropdown, that's the right time to extract a
 * shared `DropdownMenu` primitive.
 *
 * `analyzeButtonRef` is plumbed through so the workspace-report
 * popover (which positions itself relative to its trigger) keeps
 * working — the popover anchors to the menu item's DOM node, not the
 * collapsed parent button. When the menu is closed the ref points at
 * `null`, which the popover hook tolerates as "no anchor yet".
 */
function DashboardActionsMenu({
  onDiscover,
  onNewStack,
  onRescan,
  onAnalyze,
  analyzeButtonRef,
  disableAnalyze,
  disableRescan,
  rescanLabel,
}: {
  onDiscover: () => void;
  onNewStack: () => void;
  onRescan: () => void;
  onAnalyze: () => void;
  analyzeButtonRef: React.Ref<HTMLButtonElement>;
  disableAnalyze: boolean;
  disableRescan: boolean;
  rescanLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const select = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More workspace actions"
        rightIcon={
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        }
      >
        Actions
      </Button>
      {open && (
        <div
          role="menu"
          className="border-border bg-surface-raised rounded-app animate-fade-in absolute right-0 z-50 mt-1.5 w-[320px] overflow-hidden border py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          <MenuItem
            icon={<FolderSearch className="h-3.5 w-3.5" />}
            label="Discover projects"
            hint="Walk parent folders"
            onClick={select(onDiscover)}
          />
          <MenuItem
            icon={<Layers className="h-3.5 w-3.5" />}
            label="New stack"
            hint="Group services"
            onClick={select(onNewStack)}
          />
          <div className="border-border/60 my-1 border-t" aria-hidden />
          <MenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label={rescanLabel}
            hint="npm outdated · cargo audit"
            onClick={select(onRescan)}
            disabled={disableRescan}
          />
          <MenuItem
            ref={analyzeButtonRef}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Analyze workspace"
            hint="AI report across all projects"
            onClick={select(onAnalyze)}
            disabled={disableAnalyze}
          />
        </div>
      )}
    </div>
  );
}

const MenuItem = forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    onClick: () => void;
    disabled?: boolean;
  }
>(function MenuItem({ icon, label, hint, onClick, disabled }, ref) {
  return (
    <button
      ref={ref}
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] whitespace-nowrap transition',
        disabled
          ? 'text-fg-dim/50 cursor-not-allowed'
          : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
      )}
    >
      <span className={cn('shrink-0', disabled ? 'text-fg-dim/50' : 'text-fg-dim')}>{icon}</span>
      <span className="shrink-0 font-medium">{label}</span>
      {hint && <span className="text-fg-dim ml-auto truncate pl-2 text-[10.5px]">{hint}</span>}
    </button>
  );
});
