import type {
  GitStatus,
  OverviewSummary,
  ProjectOverview,
  ResourceSample,
  ServiceDef,
  ServiceStatus,
  Status,
} from '@/types';

/**
 * Per-project facts shipped to the LLM. Field names are intentionally
 * snake_case so they read naturally inside the JSON code-fence the
 * model sees ("3 critical CVEs in `belgehub-mobile`" reads better
 * than `cveCritical`). Everything is optional except `name` and
 * `status` because we want the JSON shape to fail closed when the
 * dashboard hasn't yet polled audit / git / resources for a service —
 * the model handles missing keys gracefully but can't recover from
 * `null`s pretending to be data.
 */
interface WorkspaceProjectFact {
  name: string;
  runtime?: string | null;
  status: Status;
  cpu_percent?: number;
  memory_mb?: number;
  branch?: string | null;
  dirty_files?: number;
  ahead?: number;
  behind?: number;
  has_upstream?: boolean;
  last_activity?: string | null;
  days_since_activity?: number;
  is_stale?: boolean;
  cve?: { critical: number; high: number; medium: number; low: number };
  outdated?: { total: number; major: number; minor: number; patch: number };
}

interface WorkspaceTotals {
  project_count: number;
  running: number;
  starting: number;
  stopped: number;
  failed: number;
  listening_ports: number;
  total_cpu_percent: number;
  total_memory_mb: number;
  has_dependency_scan: boolean;
  cve_critical: number;
  cve_high: number;
  cve_medium: number;
  cve_low: number;
  outdated_packages: number;
  stale_projects: number;
  dirty_projects: number;
}

export interface WorkspaceFacts {
  workspace: WorkspaceTotals;
  projects: WorkspaceProjectFact[];
}

/**
 * Risk score used purely to *order* the projects array in the JSON
 * payload — it has no UI surface and doesn't need to match the
 * dashboard's own `riskScore`. The LLM uses array order as a soft
 * "most likely to matter" hint but is told (in the prompt) not to
 * trust it blindly. Critical CVEs dominate; staleness + dirty git
 * tie-break.
 */
function projectImportance(p: WorkspaceProjectFact): number {
  const cveCritical = p.cve?.critical ?? 0;
  const cveHigh = p.cve?.high ?? 0;
  const cveMedium = p.cve?.medium ?? 0;
  const failed = p.status === 'crashed' || p.status === 'exited' ? 1 : 0;
  const stale = p.is_stale ? 1 : 0;
  const dirty = (p.dirty_files ?? 0) > 0 ? 1 : 0;
  const outdatedMajor = p.outdated?.major ?? 0;
  return (
    cveCritical * 100 +
    cveHigh * 25 +
    cveMedium * 5 +
    failed * 30 +
    stale * 4 +
    dirty * 2 +
    outdatedMajor
  );
}

function daysBetween(iso: string | null | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function statusFor(svc: ServiceDef, statuses: Record<string, ServiceStatus | undefined>): Status {
  return statuses[svc.id]?.status ?? 'stopped';
}

/**
 * Hard cap on projects shipped to the model. Beyond ~40 projects
 * the JSON blob exceeds 12K chars and gets tail-trimmed by the
 * Rust prompt builder anyway — better to send the highest-signal
 * 40 ourselves so the model sees `risk → wins → steady` instead
 * of an arbitrary alphabetical tail. Mono-repo workspaces with
 * 200+ services are real but rare; if we hit them we'd add a
 * per-section breakdown rather than ship more rows.
 */
const MAX_PROJECTS_IN_REPORT = 40;

/**
 * Aggregate the dashboard's live state into a single JSON blob the
 * LLM can reason over. Pure function — does not touch React state
 * or run side effects, so it's safe to call from `useMemo` /
 * outside the render cycle.
 *
 * Inputs mirror the dashboard's own `useAppStore` selectors so the
 * caller can invoke this with what it already has on hand:
 *
 *     buildWorkspaceFacts({
 *       services, statuses, resources, git, ports, overview,
 *     });
 */
export function buildWorkspaceFacts(input: {
  services: ServiceDef[];
  statuses: Record<string, ServiceStatus | undefined>;
  resources: Record<string, ResourceSample | undefined>;
  git: Record<string, GitStatus | null | undefined>;
  /** How many ports are currently listening across all running
   *  services. Caller passes `ports.length` from the store; we
   *  don't need the per-port detail at this level. */
  listening_port_count: number;
  overview: OverviewSummary | null;
}): WorkspaceFacts {
  const { services, statuses, resources, git, listening_port_count, overview } = input;
  const now = Date.now();
  const projectMeta = new Map<string, ProjectOverview>();
  if (overview) for (const p of overview.projects) projectMeta.set(p.service_id, p);

  let running = 0;
  let starting = 0;
  let stopped = 0;
  let failed = 0;
  let cveCritical = 0;
  let cveHigh = 0;
  let cveMedium = 0;
  let cveLow = 0;
  let outdatedPackages = 0;
  let staleProjects = 0;
  let dirtyProjects = 0;
  let totalCpu = 0;
  let totalMem = 0;

  const projects: WorkspaceProjectFact[] = [];

  for (const svc of services) {
    const st = statusFor(svc, statuses);
    if (st === 'running') running++;
    else if (st === 'starting' || st === 'stopping') starting++;
    else if (st === 'crashed' || st === 'exited') failed++;
    else stopped++;

    const meta = projectMeta.get(svc.id);
    const res = resources[svc.id];
    const g = git[svc.id] ?? meta?.git_status ?? null;
    const audit = meta?.audit ?? null;
    const outdated = meta?.outdated ?? null;
    const isRunning = st === 'running' || st === 'starting';

    if (isRunning && res) {
      totalCpu += res.cpu_percent;
      totalMem += res.memory_bytes;
    }

    if (audit) {
      cveCritical += audit.critical ?? 0;
      cveHigh += audit.high ?? 0;
      cveMedium += audit.medium ?? 0;
      cveLow += audit.low ?? 0;
    }
    if (outdated) outdatedPackages += outdated.total ?? 0;
    if (meta?.is_stale) staleProjects++;
    if (g?.is_dirty) dirtyProjects++;

    const lastActivity = meta?.last_activity ?? null;
    const fact: WorkspaceProjectFact = {
      name: svc.name,
      runtime: meta?.runtime ?? null,
      status: st,
    };

    if (isRunning && res) {
      fact.cpu_percent = Math.round(res.cpu_percent * 10) / 10;
      fact.memory_mb = Math.round(res.memory_bytes / (1024 * 1024));
    }

    if (g) {
      fact.branch = g.branch;
      fact.dirty_files = g.dirty_count;
      fact.ahead = g.ahead;
      fact.behind = g.behind;
      fact.has_upstream = !!g.upstream;
    }

    if (lastActivity) {
      fact.last_activity = lastActivity;
      const days = daysBetween(lastActivity, now);
      if (days !== undefined) fact.days_since_activity = days;
    }
    if (meta?.is_stale) fact.is_stale = true;

    if (audit && (audit.critical || audit.high || audit.medium || audit.low)) {
      fact.cve = {
        critical: audit.critical ?? 0,
        high: audit.high ?? 0,
        medium: audit.medium ?? 0,
        low: audit.low ?? 0,
      };
    }
    if (outdated && outdated.total > 0) {
      fact.outdated = {
        total: outdated.total,
        major: outdated.major ?? 0,
        minor: outdated.minor ?? 0,
        patch: outdated.patch ?? 0,
      };
    }

    projects.push(fact);
  }

  projects.sort((a, b) => {
    const ra = projectImportance(a);
    const rb = projectImportance(b);
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });

  const trimmed = projects.slice(0, MAX_PROJECTS_IN_REPORT);

  return {
    workspace: {
      project_count: services.length,
      running,
      starting,
      stopped,
      failed,
      listening_ports: listening_port_count,
      total_cpu_percent: Math.round(totalCpu * 10) / 10,
      total_memory_mb: Math.round(totalMem / (1024 * 1024)),
      has_dependency_scan: overview?.has_dependency_scan ?? false,
      cve_critical: cveCritical,
      cve_high: cveHigh,
      cve_medium: cveMedium,
      cve_low: cveLow,
      outdated_packages: outdatedPackages,
      stale_projects: staleProjects,
      dirty_projects: dirtyProjects,
    },
    projects: trimmed,
  };
}
