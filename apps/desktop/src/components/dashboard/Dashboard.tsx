import {
  forwardRef,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
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
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { Select } from '@/components/ui/Select';
import { Drawer } from '@/components/ui/Drawer';
import { ProjectDetailDrawer, type DetailTab } from '@/components/ProjectDetailDrawer';

// Lazy-load the per-service overlay panels so a dashboard with 50 cards
// doesn't pay the bundle cost for components only opened on click.
// Mounted inside a single Drawer slot at the dashboard root — see the
// `serviceOverlay` state below for the lifting rationale.
//
// Notes used to live alongside the License overlay here, but the
// notes surface graduated to a body tab inside the LogPanel
// (`ProjectNotesTab`) — clicking the notes affordance on a service
// card now opens the service tab AND deep-links the user into the
// Notes body tab via `openServiceWithBodyTab`. We keep `LicensePanel`
// drawer-mounted because its content is wide-ish (license tables,
// THIRD-PARTY-NOTICES generation) and shows up in cross-service
// audit flows where the user *isn't* viewing a single service yet.
const LicensePanel = lazy(() =>
  import('@/components/LicensePanel').then((m) => ({ default: m.LicensePanel })),
);

/** Which per-service overlay (if any) is currently open. */
type ServiceOverlayKind = 'license';
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

/**
 * Match a service against a free-text search query.
 *
 * Plain case-insensitive substring across every field a user might
 * plausibly type into the search box. Deliberately *not* fuzzy: with
 * a workspace measured in tens of services (the ~11 case shown in
 * the dashboard hero is typical), a substring match is precise,
 * predictable, and never produces the "why is THIS card matching?"
 * surprise that token-permuted fuzzy ranking creates. If a user's
 * roster ever crosses ~200 services we'd revisit this with a real
 * tokenizer — until then YAGNI.
 *
 * The function returns a numeric *score* rather than a boolean so the
 * caller can break ties between projects that match equally well on
 * different axes. Higher = stronger match. Zero = no match. The score
 * is only used for tie-breaking inside the existing comparator chain;
 * primary sort still respects the user's chosen `sortBy` axis so
 * search doesn't silently override "Last activity" / "Risk" / etc.
 *
 * Field weights (rationale):
 *   - name (10): the user almost always remembers the project's name
 *     first. A name match is the highest-confidence signal.
 *   - tags (5): tags are user-curated category/runtime/team labels.
 *     Stronger than command/path because a tag match implies "the
 *     user *meant* this category", not just incidental string overlap.
 *   - port (4): typing a port number ("3000") is a common reflex when
 *     hunting "which service is on that port?".
 *   - command (3): scripts often share words ("dev", "start") so this
 *     is noisier than name/tag, but still useful for "find the one
 *     that runs `react-app-rewired`".
 *   - cwd path (2): substring-matches a folder. Covers "I know it
 *     lives under ~/work/team-x" use case, but lots of services share
 *     parent dirs so the signal is weak.
 *
 * Multiple-field hits compound — a query that hits both name and tag
 * sums both weights — so a project named "frontend-v2" tagged
 * "frontend" beats one merely tagged "frontend" when the user types
 * "frontend".
 */
function searchScore(svc: ServiceDef, needle: string): number {
  if (!needle) return 0;
  const q = needle.toLowerCase();
  let score = 0;
  if (svc.name.toLowerCase().includes(q)) score += 10;
  for (const t of svc.tags) {
    if (t.toLowerCase().includes(q)) {
      score += 5;
      // One tag hit is enough; multiple matching tags would inflate
      // weight beyond intent (a project tagged "node" "node-18" "node-lts"
      // shouldn't dominate over one tagged "node" alone).
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
 *   1. failures        → ship-tonight signal, takes precedence even if
 *                        other services are happily running.
 *   2. critical CVE    → security debt, beats license + outdated
 *                        because patching a critical CVE is
 *                        non-deferrable and gates a release outright.
 *   3. license risk    → contamination is not "fix tonight" pressure
 *                        like a CVE, but it can torpedo a commercial
 *                        ship date (AGPL leak in the SaaS = mandatory
 *                        license review). Promoted ahead of plain
 *                        outdated because it's a *legal* deferral, not
 *                        just maintenance debt.
 *   4. running         → positive state worth surfacing when there's
 *                        no active fire, gives a sense of "things are
 *                        alive".
 *   5. outdated        → maintenance debt, deferrable but accumulating.
 *   6. idle fallback.
 */
function deriveHeroState(
  stats: { running: number; failed: number; starting: number },
  attention: { cveCritical: number; licenseRisk: number; outdated: number } | null,
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
  const openServiceWithBodyTab = useAppStore((s) => s.openServiceWithBodyTab);
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
  type AttentionFilter = 'all' | 'stale' | 'risk' | 'outdated' | 'license';
  const [gitFilter, setGitFilter] = useState<GitFilter>('all');
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all');

  // The search query Dashboard actually filters by. This is the
  // *committed* query — only changes once the user pauses typing
  // (see DashboardSearchBar's debounce below). Keeping the live
  // keystroke state in a child component is what makes typing feel
  // instant: each character no longer re-renders the entire dashboard
  // tree (header, filter chips, group sections, 11 service cards),
  // just the search bar's own input element.
  //
  // Persistence is intentionally NOT attempted here — search is a
  // transient act, not a saved view. If users want a sticky slice
  // they reach for tags + section grouping above. A half-typed query
  // restored on the next launch ("oh, where are my cards?") is more
  // confusing than helpful.
  const [committedQuery, setCommittedQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveQuery = committedQuery;

  // `/` to focus, `Esc` to clear+blur — modeled on GitHub/Linear.
  // We bind on `document` (not the input itself) so the shortcut works
  // regardless of focus, but we *don't* hijack the keystroke when the
  // user is already typing into another input/textarea/contenteditable
  // (e.g. a service editor field, the AI chat box). That guard is
  // what separates a polished dashboard shortcut from one that
  // sabotages the rest of the app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Detail drawer lives at the dashboard level so flipping between
  // different cards' deps/audit chips just swaps the drawer contents
  // rather than unmount/remount on every click.
  const [detail, setDetail] = useState<{ serviceId: string; tab: DetailTab } | null>(null);
  const openDetail = useCallback((serviceId: string, tab: DetailTab) => {
    setDetail({ serviceId, tab });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // Per-service overlays (Notes / License) are also lifted
  // here. The reason isn't ergonomics but layout: each `ServiceCard`
  // is wrapped in `.glass`, which sets `backdrop-filter` +
  // `isolation: isolate`. CSS spec says either of those promotes the
  // element to a new containing block for `position: absolute`
  // descendants — the drawer's `inset-0` would scope to the card's
  // bounds instead of the dashboard region. Mounting the overlay at
  // the dashboard root (next to `ProjectDetailDrawer`, which uses
  // the same trick for the same reason) puts the drawer inside a
  // clean `relative`-positioned ancestor and lets it fill the right
  // side of the dashboard the way the user expects.
  const [serviceOverlay, setServiceOverlay] = useState<{
    serviceId: string;
    kind: ServiceOverlayKind;
  } | null>(null);
  // ServiceCard still calls this with `'notes' | 'license'` for
  // backward source compat, but only `'license'` lands as a drawer
  // overlay now — `'notes'` deep-links into the service tab's
  // body NOTES tab via `openServiceWithBodyTab`. Keeping the
  // single-prop API on the card means we don't have to thread two
  // separate callbacks through the dashboard ↔ stacks ↔ unassigned
  // sections; the routing decision lives here at the dashboard
  // root where it logically belongs.
  const openServiceOverlay = useCallback(
    (serviceId: string, kind: 'notes' | 'license') => {
      if (kind === 'notes') {
        openServiceWithBodyTab(serviceId, 'notes');
        return;
      }
      setServiceOverlay({ serviceId, kind });
    },
    [openServiceWithBodyTab],
  );
  const closeServiceOverlay = useCallback(() => setServiceOverlay(null), []);
  const overlayService = useMemo(() => {
    if (!serviceOverlay) return null;
    return services.find((s) => s.id === serviceOverlay.serviceId) ?? null;
  }, [serviceOverlay, services]);
  // If the underlying service disappears (deleted from another
  // surface, hot-reload, etc.) while its overlay is open, close the
  // drawer rather than render a panel pointing at a phantom id —
  // the panels would otherwise IPC-fetch with the stale id and
  // surface a confusing "not found" error.
  useEffect(() => {
    if (serviceOverlay && !overlayService) setServiceOverlay(null);
  }, [serviceOverlay, overlayService]);

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
    let licenseRiskProjects = 0;
    let licenseWarnings = 0;
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

      // License contamination — same "ship-tonight" axes the
      // ServiceCard chip uses (strong + network + proprietary).
      // Roster count drives the FilterChip ("3 projects with
      // license risk"); package-level total feeds the hero
      // headline ("12 license risk packages").
      const lic = p.license;
      const licenseTotal = lic
        ? (lic.strong_copyleft_count ?? 0) +
          (lic.network_copyleft_count ?? 0) +
          (lic.proprietary_count ?? 0)
        : 0;
      if (licenseTotal > 0) licenseRiskProjects++;
      licenseWarnings += licenseTotal;
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
      licenseRisk: licenseRiskProjects,
      licenseWarnings,
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
        case 'license': {
          const lic = meta.license;
          if (!lic) return false;
          return (
            (lic.strong_copyleft_count ?? 0) +
              (lic.network_copyleft_count ?? 0) +
              (lic.proprietary_count ?? 0) >
            0
          );
        }
        default:
          return true;
      }
    },
    [attentionFilter, projectMetaById],
  );

  // Search is *deliberately* excluded from `eligibleServices`. The
  // services that survive git/attention filters define the dashboard's
  // mount roster — change that set and React mounts/unmounts cards.
  // Each mount runs ~10 Zustand subscriptions, an AI hook, and SVG
  // sparkline setup, so a search that flips two cards in/out of the
  // result set was costing two unmounts plus two mounts on every
  // keystroke that crossed a match boundary. With ~11 services that
  // alone is enough to make typing visibly lag.
  //
  // Instead we keep the mount roster stable across search and apply
  // search as a *visibility* filter at render time (see `searchHits`
  // below). Cards that don't match the query stay mounted but are
  // hidden via `display: none` on a wrapper element. The DOM keeps a
  // few extra hidden nodes; the user gets sub-frame typing latency.
  const eligibleServices = useMemo(() => {
    const stackServiceIds = new Set(stacks.flatMap((st) => st.service_ids));
    return services.filter(
      (svc) =>
        !stackServiceIds.has(svc.id) && gitFilterFn(svc, git[svc.id]) && attentionFilterFn(svc),
    );
  }, [services, stacks, gitFilterFn, git, attentionFilterFn]);

  // Set of service IDs that match the active search query. `null`
  // when the box is empty, so render-side checks short-circuit to "no
  // hidden cards" without paying for a Set lookup. Computed across
  // the *full* roster (including stacked services), so the same hits
  // map drives both the standalone group sections and the stack
  // sections — a search hit lights up its card whether it lives in a
  // stack or not.
  const searchHits = useMemo<ReadonlySet<string> | null>(() => {
    if (effectiveQuery === '') return null;
    const hits = new Set<string>();
    for (const svc of services) {
      if (searchScore(svc, effectiveQuery) > 0) hits.add(svc.id);
    }
    return hits;
  }, [services, effectiveQuery]);

  // Total count of services that survive *every* filter (search + git +
  // attention), regardless of whether they live in a stack. Drives the
  // "no matches" empty state and the result count next to the search
  // input.
  const totalMatchedCount = useMemo(() => {
    if (effectiveQuery === '' && gitFilter === 'all' && attentionFilter === 'all') {
      return services.length;
    }
    return services.filter(
      (svc) =>
        gitFilterFn(svc, git[svc.id]) &&
        attentionFilterFn(svc) &&
        (effectiveQuery === '' || searchScore(svc, effectiveQuery) > 0),
    ).length;
  }, [services, effectiveQuery, gitFilter, attentionFilter, gitFilterFn, attentionFilterFn, git]);

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
    // When a search is active, primary sort is search relevance — the
    // user's clearly hunting a specific project, so respecting their
    // chosen `sortBy` axis would bury the best match below noise.
    // Fall back to the regular axis on ties (equal scores) so the
    // ordering remains predictable inside a relevance bucket. With no
    // active query this branch is a no-op and we go straight to the
    // user's chosen axis. We use `effectiveQuery` (not the raw input)
    // so the comparator stays consistent with the filtered set —
    // when the user clears the box, the relevance bucket disappears
    // synchronously and we fall straight back to their chosen axis
    // instead of "phantom-relevance" sorting on a stale query.
    const bySearch =
      effectiveQuery !== ''
        ? (a: ServiceDef, b: ServiceDef) => {
            const sa = searchScore(a, effectiveQuery);
            const sb = searchScore(b, effectiveQuery);
            if (sb !== sa) return sb - sa;
            return 0;
          }
        : null;
    const withSearch =
      (axis: (a: ServiceDef, b: ServiceDef) => number) => (a: ServiceDef, b: ServiceDef) => {
        if (bySearch) {
          const r = bySearch(a, b);
          if (r !== 0) return r;
        }
        return axis(a, b);
      };
    switch (sortBy) {
      case 'name':
        return withSearch(byName);
      case 'activity':
        return withSearch((a: ServiceDef, b: ServiceDef) => {
          const ma = projectMetaById.get(a.id)?.last_activity;
          const mb = projectMetaById.get(b.id)?.last_activity;
          const ta = ma ? new Date(ma).getTime() : 0;
          const tb = mb ? new Date(mb).getTime() : 0;
          if (tb !== ta) return tb - ta;
          return byName(a, b);
        });
      case 'risk':
        return withSearch((a: ServiceDef, b: ServiceDef) => {
          const ra = riskScore(projectMetaById.get(a.id));
          const rb = riskScore(projectMetaById.get(b.id));
          if (rb !== ra) return rb - ra;
          return byName(a, b);
        });
      case 'memory':
        return withSearch((a: ServiceDef, b: ServiceDef) => {
          const ma = runningServiceIds.has(a.id) ? (resources[a.id]?.memory_bytes ?? 0) : -1;
          const mb = runningServiceIds.has(b.id) ? (resources[b.id]?.memory_bytes ?? 0) : -1;
          if (mb !== ma) return mb - ma;
          return byName(a, b);
        });
      case 'cpu':
        return withSearch((a: ServiceDef, b: ServiceDef) => {
          const ca = runningServiceIds.has(a.id) ? (resources[a.id]?.cpu_percent ?? 0) : -1;
          const cb = runningServiceIds.has(b.id) ? (resources[b.id]?.cpu_percent ?? 0) : -1;
          if (cb !== ca) return cb - ca;
          return byName(a, b);
        });
      default:
        return withSearch(byName);
    }
  }, [sortBy, projectMetaById, runningServiceIds, resources, effectiveQuery]);

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
                        title="Re-run npm outdated / cargo audit / license scan across all projects"
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
                          title="Run npm outdated / cargo audit / license scan across all projects"
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
                Right cluster: primary "+ New service" CTA plus a
                promoted "Analyze" button (the AI workspace-report
                trigger), plus an overflow menu for the lower-frequency
                actions (Discover projects / New stack / Rescan deps).

                "Analyze workspace" used to live inside the Actions
                dropdown, but burying the only AI-driven, multi-project
                diagnostic behind a two-click menu killed its
                discoverability — most users never knew it existed.
                Surfacing it as a Sparkles-prefixed ghost button keeps
                the primary "+ New service" CTA visually dominant
                (only it carries the accent fill) while making the
                marquee AI feature one click away. The remaining
                three actions stay in the dropdown because they're
                each used at most once a day per workspace.
              */}
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  ref={workspaceReportTriggerRef}
                  variant="secondary"
                  size="sm"
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  onClick={() => {
                    if (services.length === 0) return;
                    launchWorkspaceReport();
                  }}
                  disabled={services.length === 0}
                  title="AI report across all projects"
                >
                  Analyze Workspace
                </Button>
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
              <DashboardSearchBar inputRef={searchInputRef} onCommit={setCommittedQuery} />

              {attentionStats &&
                attentionStats.stale +
                  attentionStats.risk +
                  attentionStats.outdated +
                  attentionStats.licenseRisk >
                  0 && (
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
                    {attentionStats.licenseRisk > 0 && (
                      <FilterChip
                        active={attentionFilter === 'license'}
                        onClick={() =>
                          setAttentionFilter((a) => (a === 'license' ? 'all' : 'license'))
                        }
                        tone="critical"
                        icon={<Scale className="h-3 w-3" />}
                        label="License"
                        count={attentionStats.licenseRisk}
                        title={`${attentionStats.licenseRisk} project${
                          attentionStats.licenseRisk === 1 ? '' : 's'
                        } with strong/network copyleft or proprietary contamination (${
                          attentionStats.licenseWarnings
                        } package${attentionStats.licenseWarnings === 1 ? '' : 's'} total)`}
                      />
                    )}
                  </FilterChipGroup>
                )}

              {gitStats.dirty + gitStats.clean > 0 && (
                <>
                  {attentionStats &&
                    attentionStats.stale +
                      attentionStats.risk +
                      attentionStats.outdated +
                      attentionStats.licenseRisk >
                      0 && (
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
              // For chrome (header count, running-count, hidden-when-empty)
              // we want the *visible* slice — search-hidden cards are still
              // mounted (so typing stays cheap) but shouldn't inflate the
              // section's chip counters or keep an otherwise-empty stack
              // visible during an active search.
              const visibleStackServices = searchHits
                ? stackServices.filter((svc) => searchHits.has(svc.id))
                : stackServices;
              const runningCount = visibleStackServices.filter(
                (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
              ).length;
              const anyRunning = runningCount > 0;
              const sectionHidden = searchHits !== null && visibleStackServices.length === 0;
              return (
                <section
                  key={stack.id}
                  className="group/section"
                  // Keep the section (and every ServiceCard inside it)
                  // mounted across search transitions; collapse it via
                  // CSS instead. Toggling `display` is a paint-only op,
                  // unlike conditionally rendering — which would
                  // unmount/remount every card on each keystroke.
                  style={sectionHidden ? { display: 'none' } : undefined}
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
                    count={visibleStackServices.length}
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
                    {stackServices.map((svc) => {
                      const cardHidden = searchHits !== null && !searchHits.has(svc.id);
                      return (
                        <CardSearchSlot key={svc.id} hidden={cardHidden}>
                          <ServiceCard
                            svc={svc}
                            projectMeta={projectMetaById.get(svc.id) ?? null}
                            onOpenDetail={openDetail}
                            onOpenOverlay={openServiceOverlay}
                          />
                        </CardSearchSlot>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {/*
              Empty state when filters/search produce nothing. Bound to
              `effectiveQuery` (not raw `trimmedQuery`) so its display
              stays consistent with `totalMatchedCount` and the cards
              below — otherwise the banner could flash "No matches for
              X" while the cards still show the previous query's results
              for one frame. Clearing the box collapses `effectiveQuery`
              to '' synchronously so this banner disappears in the same
              tick the user hits Esc / clicks the ✕.
            */}
            {totalMatchedCount === 0 &&
              (effectiveQuery !== '' || gitFilter !== 'all' || attentionFilter !== 'all') && (
                <div className="border-border/60 bg-surface-raised/40 rounded-app flex flex-col items-center gap-2 border border-dashed px-6 py-10 text-center">
                  <Search className="text-fg-dim/70 h-5 w-5" />
                  <p className="text-fg text-[13px] font-medium">
                    {effectiveQuery !== '' ? (
                      <>
                        No matches for{' '}
                        <span className="text-accent font-mono">"{effectiveQuery}"</span>
                      </>
                    ) : (
                      'No projects match the current filters'
                    )}
                  </p>
                  <p className="text-fg-dim text-[11.5px]">
                    {effectiveQuery !== ''
                      ? 'Search covers names, tags, ports, commands, and paths.'
                      : 'Try clearing one or more filters above.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCommittedQuery('');
                      // Also clear the input element directly — the
                      // search bar owns its own live state, so a parent
                      // setState alone won't empty the visible textbox.
                      // Dispatching an `input` event keeps the bar's
                      // controlled state in sync via its onChange path.
                      const el = searchInputRef.current;
                      if (el) {
                        const setter = Object.getOwnPropertyDescriptor(
                          window.HTMLInputElement.prototype,
                          'value',
                        )?.set;
                        setter?.call(el, '');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                      }
                      setGitFilter('all');
                      setAttentionFilter('all');
                    }}
                    className="text-accent hover:text-accent/80 mt-1 text-[11.5px] font-semibold transition"
                  >
                    Clear all filters
                  </button>
                </div>
              )}

            {groups.length > 0
              ? groups.map((group) => {
                  // Same trick as the stack section: derive header
                  // counters from the *visible* slice so the chips
                  // reflect what the user can actually see, while
                  // every card in the group stays mounted (search
                  // visibility is a CSS toggle, not a remount).
                  const visibleGroupServices = searchHits
                    ? group.services.filter((svc) => searchHits.has(svc.id))
                    : group.services;
                  const runningInGroup = visibleGroupServices.filter(
                    (svc) => (statuses[svc.id]?.status ?? 'stopped') === 'running',
                  ).length;
                  const sectionHidden = searchHits !== null && visibleGroupServices.length === 0;
                  return (
                    <section
                      key={group.key}
                      className="group/section"
                      style={sectionHidden ? { display: 'none' } : undefined}
                    >
                      <SectionHeader
                        dotClass={group.dotClass}
                        dotStyle={group.dotStyle}
                        label={group.label}
                        labelClass={group.labelClass}
                        labelStyle={group.labelStyle}
                        count={visibleGroupServices.length}
                        runningCount={runningInGroup}
                      />
                      <div className="mt-3 grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                        {group.services.map((svc) => {
                          const cardHidden = searchHits !== null && !searchHits.has(svc.id);
                          return (
                            <CardSearchSlot key={svc.id} hidden={cardHidden}>
                              <ServiceCard
                                svc={svc}
                                draggable
                                projectMeta={projectMetaById.get(svc.id) ?? null}
                                onOpenDetail={openDetail}
                                onOpenOverlay={openServiceOverlay}
                              />
                            </CardSearchSlot>
                          );
                        })}
                      </div>
                    </section>
                  );
                })
              : sortedEligibleServices.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
                    {sortedEligibleServices.map((svc) => {
                      const cardHidden = searchHits !== null && !searchHits.has(svc.id);
                      return (
                        <CardSearchSlot key={svc.id} hidden={cardHidden}>
                          <ServiceCard
                            svc={svc}
                            draggable
                            projectMeta={projectMetaById.get(svc.id) ?? null}
                            onOpenDetail={openDetail}
                            onOpenOverlay={openServiceOverlay}
                          />
                        </CardSearchSlot>
                      );
                    })}
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
      {/*
        Per-service overlays — Notes / License.
        Mounted at the dashboard root for the same containing-block
        reason the project-detail drawer is: a `position: absolute
        inset-0` chrome inside `ServiceCard` would scope to the
        card's `.glass` box (backdrop-filter + isolation create a
        new containing block), but at the dashboard root it scopes
        to the entire dashboard region — main column + activity
        rail combined — and the OS titlebar / global sidebar stay
        visible and clickable. Lazy-loaded so a dashboard with 50
        cards doesn't pay the bundle cost for panels only opened
        on click.

        Only LICENSE renders here now; NOTES used to live next to
        it but moved into a body tab inside the service view —
        the notes button on `ServiceCard` deep-links into that
        tab via `openServiceWithBodyTab` instead of opening a
        drawer.
      */}
      {serviceOverlay && overlayService && serviceOverlay.kind === 'license' && (
        <Drawer onClose={closeServiceOverlay} ariaLabel="License compliance" size="lg">
          <Suspense fallback={<div className="text-fg-dim p-4 text-[12px]">Loading…</div>}>
            <LicensePanel
              serviceId={overlayService.id}
              serviceName={overlayService.name}
              onClose={closeServiceOverlay}
            />
          </Suspense>
        </Drawer>
      )}
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
 * Overflow menu for the dashboard hero. Houses workspace-level
 * actions that aren't either of the two promoted CTAs ("+ New
 * service" and "Analyze") — so those stay visually dominant in the
 * top-right slot without three near-equal siblings stealing weight.
 *
 * Why a hand-rolled menu (instead of pulling in @radix-ui/dropdown-menu
 * or similar): we already lean on the same click-outside + Escape
 * pattern in `ThemeMenu`/`SectionMenus`/`HistoryDrawer`; adopting it
 * here keeps the bundle lean and matches the local idiom. If a fourth
 * surface needs the same dropdown, that's the right time to extract a
 * shared `DropdownMenu` primitive.
 */
function DashboardActionsMenu({
  onDiscover,
  onNewStack,
  onRescan,
  disableRescan,
  rescanLabel,
}: {
  onDiscover: () => void;
  onNewStack: () => void;
  onRescan: () => void;
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
            hint="npm outdated · cargo audit · license scan"
            onClick={select(onRescan)}
            disabled={disableRescan}
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

/**
 * Wrapper that shows or hides a ServiceCard via CSS only.
 *
 * Critical that this is `display: contents` (not, say, a div with
 * `display: block`) when visible — the parent grid container relies
 * on the card being a *direct* grid item to size it. A wrapper that
 * participates in layout would collapse every card to a single column
 * regardless of the grid template. With `contents`, the wrapper has
 * no box of its own; the ServiceCard stays the grid item.
 *
 * On hide, `display: none` removes the entire subtree from layout
 * AND from accessibility/tab order — exactly what we want for a
 * filtered-out card. The card stays mounted (so its Zustand
 * subscriptions, AI hooks, and SVG sparklines don't tear down and
 * re-set up on every keystroke), but is invisible and inert.
 *
 * Memoized so toggling sibling cards doesn't churn this one.
 */
const CardSearchSlot = memo(function CardSearchSlot({
  hidden,
  children,
}: {
  hidden: boolean;
  children: React.ReactNode;
}) {
  return <div style={hidden ? CARD_SLOT_HIDDEN : CARD_SLOT_VISIBLE}>{children}</div>;
});
const CARD_SLOT_HIDDEN: React.CSSProperties = { display: 'none' };
const CARD_SLOT_VISIBLE: React.CSSProperties = { display: 'contents' };

/**
 * Search box, isolated from Dashboard's render tree.
 *
 * Two-layer setup:
 *
 *   1. Local `text` state owns the live keystroke. The bar's own
 *      input element is the only thing that re-renders per keystroke
 *      — Dashboard's enormous subtree (header, hero, attention
 *      banners, filter chips, group sections, every ServiceCard) is
 *      *never* re-rendered just to repaint the textbox.
 *
 *   2. `onCommit` propagates the query up to Dashboard inside a
 *      `useTransition` boundary. That marks Dashboard's resulting
 *      re-render as non-urgent: React keeps the textbox responsive
 *      (urgent updates always preempt transitions) and folds rapid
 *      keystrokes into a single committed value. Note this is NOT a
 *      debounce — there's no setTimeout, no wall-clock delay. The
 *      commit happens as fast as React can schedule it given the
 *      input thread's pressure. On a quiet main thread it's
 *      effectively synchronous; under typing burst it back-pressures
 *      naturally.
 *
 * Why no debounce: with the dashboard's mount roster decoupled from
 * search (cards stay mounted, search toggles `display`), the cost of
 * a search update is just a Set rebuild + a comparator pass + a
 * style toggle on each card wrapper. That's microseconds for a
 * realistic roster, well below any debounce window worth waiting
 * for. Adding a debounce now would only add perceived latency.
 *
 * Cards that don't match the active query render `display: none`
 * inside `CardSearchSlot`, so the DOM stays steady and only the
 * wrapper styles change between renders.
 */
const DashboardSearchBar = memo(function DashboardSearchBar({
  inputRef,
  onCommit,
}: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onCommit: (q: string) => void;
}) {
  const [text, setText] = useState('');
  const [, startTransition] = useTransition();
  const trimmedQuery = text.trim();

  // Stable ref to the latest `onCommit` so the commit handler doesn't
  // re-bind whenever the parent passes a fresh closure (defensive —
  // setState identity is already stable, but useEffect deps love
  // pretending otherwise).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const handleChange = useCallback(
    (next: string) => {
      // Urgent: keep the textbox in sync with the keystroke. Skipping
      // setState here would make the input feel laggy regardless of
      // how fast the rest of the pipeline runs.
      setText(next);
      // Non-urgent: propagate to Dashboard inside a transition. React
      // is free to delay this re-render if more keystrokes arrive
      // first, and the textbox stays responsive throughout.
      startTransition(() => {
        onCommitRef.current(next.trim());
      });
    },
    [startTransition],
  );

  const clear = useCallback(() => {
    setText('');
    startTransition(() => {
      onCommitRef.current('');
    });
    inputRef.current?.focus();
  }, [inputRef, startTransition]);

  return (
    <div
      className={cn(
        'border-border bg-surface-raised rounded-app-sm group relative flex h-7 items-center gap-1.5 border px-2.5 transition',
        'focus-within:border-fg-dim/45',
        trimmedQuery !== '' && 'border-fg-dim/35',
      )}
    >
      <Search
        className={cn(
          'h-3 w-3 shrink-0 transition',
          trimmedQuery === '' ? 'text-fg-dim' : 'text-fg-muted',
        )}
      />
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (text) {
              handleChange('');
            } else {
              e.currentTarget.blur();
            }
          }
        }}
        placeholder="Search projects"
        aria-label="Search projects"
        // The global `*:focus-visible` rule in styles.css paints an
        // orange accent ring on every focusable element. That ring
        // would stack inside the wrapper's `focus-within:` border and
        // read as a "border within a border".
        // `.dashboard-search-input` (defined alongside
        // `.qa-search-input` / `.history-search-input` in styles.css)
        // overrides the universal rule on specificity; the Tailwind
        // `outline-none` is kept as a belt-and-braces fallback for
        // non-`focus-visible` focus states.
        className="dashboard-search-input placeholder:text-fg-dim/70 text-fg w-44 border-none bg-transparent text-[12px] outline-none"
        spellCheck={false}
        autoComplete="off"
      />
      {trimmedQuery !== '' ? (
        <button
          type="button"
          onClick={clear}
          title="Clear search (Esc)"
          aria-label="Clear search"
          className="text-fg-dim hover:text-fg -mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <Kbd className="border-border/60 text-fg-dim/80 bg-surface-overlay/60 h-4 px-1 text-[9.5px]">
          /
        </Kbd>
      )}
    </div>
  );
});
