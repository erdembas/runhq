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
  /**
   * License contamination summary. Populated only when the project's
   * scan ran AND found at least one warning — clean trees and
   * unsupported runtimes are omitted to keep the JSON tight and
   * avoid the model citing "0 contamination" as a positive signal
   * on a runtime where the scan never ran.
   *
   * `top_warnings` is capped at 3 by the backend (`LicenseScanSummary`).
   * That's enough for the model to name a real package in its risk
   * hotspot bullet without inflating the payload.
   */
  license?: {
    network_copyleft: number;
    strong_copyleft: number;
    proprietary: number;
    top_warnings: { package: string; license: string; risk: string }[];
  };
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
  /** Total network-copyleft (AGPL/SSPL) hits across all projects.
   *  Surfaced separately from `total_license_warnings` because for a
   *  SaaS workspace, a single AGPL package eclipses ten proprietary
   *  warnings — collapsing them into one number would let the model
   *  miss the headline. */
  license_network_copyleft: number;
  /** Total strong-copyleft (GPL family) hits across all projects. */
  license_strong_copyleft: number;
  /** Total proprietary-license hits — usually fixable with a paid
   *  license rather than a re-architect, hence the third bucket. */
  license_proprietary: number;
  /** Number of projects with at least one license contamination
   *  warning. Lets the model say "license risk in `3 of 12` projects"
   *  without scanning the per-project array. */
  projects_with_license_risk: number;
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
  // License weights mirror the dashboard's `riskScore` calibration:
  // network copyleft outranks even critical CVEs (it's a
  // re-architect, not a patch), strong copyleft is comparable to
  // ~2 critical CVEs, proprietary slots between high and medium.
  // Without this, the workspace report would order an AGPL-tainted
  // project below a project with a couple of medium CVEs — exactly
  // backwards for anyone shipping commercial.
  const licNetwork = p.license?.network_copyleft ?? 0;
  const licStrong = p.license?.strong_copyleft ?? 0;
  const licProp = p.license?.proprietary ?? 0;
  return (
    licNetwork * 150 +
    licStrong * 80 +
    cveCritical * 100 +
    cveHigh * 25 +
    licProp * 15 +
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
  let licenseNetworkCopyleft = 0;
  let licenseStrongCopyleft = 0;
  let licenseProprietary = 0;
  let projectsWithLicenseRisk = 0;

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
    const license = meta?.license ?? null;
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
    if (license && license.scan_supported && license.has_contamination) {
      const net = license.network_copyleft_count ?? 0;
      const strong = license.strong_copyleft_count ?? 0;
      const prop = license.proprietary_count ?? 0;
      licenseNetworkCopyleft += net;
      licenseStrongCopyleft += strong;
      licenseProprietary += prop;
      if (net + strong + prop > 0) projectsWithLicenseRisk++;
    }

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
    // Per-project license fact: emit only when the scan ran AND
    // hit at least one warning. A clean-but-scanned project doesn't
    // need a `license: { network_copyleft: 0, ... }` row in the JSON
    // — that would just bait the model into citing zeros as positive
    // signal. The aggregate counters in `workspace.*` already tell
    // the model whether scans ran at all.
    if (license && license.scan_supported && license.has_contamination) {
      const net = license.network_copyleft_count ?? 0;
      const strong = license.strong_copyleft_count ?? 0;
      const prop = license.proprietary_count ?? 0;
      if (net + strong + prop > 0) {
        fact.license = {
          network_copyleft: net,
          strong_copyleft: strong,
          proprietary: prop,
          top_warnings: (license.top_warnings ?? []).map((w) => ({
            package: w.package,
            license: w.license,
            risk: w.risk,
          })),
        };
      }
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
      license_network_copyleft: licenseNetworkCopyleft,
      license_strong_copyleft: licenseStrongCopyleft,
      license_proprietary: licenseProprietary,
      projects_with_license_risk: projectsWithLicenseRisk,
    },
    projects: trimmed,
  };
}
