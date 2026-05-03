import { Package, Shield, ShieldAlert, Skull } from 'lucide-react';
import type { Advisory, DetectedEditor, OutdatedPackage, ProjectOverview } from '@/types';

export type DetailTab = 'advisories' | 'outdated';

export interface ProjectDetailDrawerProps {
  project: ProjectOverview;
  initialTab: DetailTab;
  scanning: boolean;
  lastScanAt: number | null;
  editors: DetectedEditor[];
  onRescan: () => void;
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenInEditor: (command: string, path: string) => void;
  onOpenUrl: (url: string) => void;
  onJump: (serviceId: string) => void;
}

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export const BUMP_ORDER = ['major', 'minor', 'patch', 'other'] as const;
export type BumpGroup = (typeof BUMP_ORDER)[number];

export const EMPTY_ADVISORIES: Advisory[] = [];
export const EMPTY_PACKAGES: OutdatedPackage[] = [];

// ---- Tone palettes -------------------------------------------------------

export type Tone = {
  /** Small accent colour for text (e.g. the current→latest pill). */
  text: string;
  /** Foreground + translucent background chip (filled filter tiles). */
  chipFilled: string;
  /** Ring used on active tiles. */
  ring: string;
  /** Short label used in tab indicators. */
  underline: string;
  icon: typeof Shield;
};

// Severity → semantic tone mapping. Same hue family as the dashboard
// chips (WorstOffenders, ServiceCard) so the user sees one continuous
// visual language: red = critical, amber = high, sky = medium, neutral
// = low / informational. Tokens come from `--tone-*-fg` / `--tone-*`
// in styles.css and auto-flip for light/dark themes.
export function severityTone(s: string): Tone {
  switch (s) {
    case 'critical':
      return {
        text: 'text-tone-critical-fg',
        chipFilled: 'bg-tone-critical/15 text-tone-critical-fg',
        ring: 'ring-tone-critical/45',
        underline: 'bg-tone-critical',
        icon: Skull,
      };
    case 'high':
      return {
        text: 'text-tone-warning-fg',
        chipFilled: 'bg-tone-warning/15 text-tone-warning-fg',
        ring: 'ring-tone-warning/45',
        underline: 'bg-tone-warning',
        icon: ShieldAlert,
      };
    case 'medium':
      return {
        text: 'text-tone-info-fg',
        chipFilled: 'bg-tone-info/12 text-tone-info-fg',
        ring: 'ring-tone-info/40',
        underline: 'bg-tone-info',
        icon: Shield,
      };
    case 'low':
      return {
        text: 'text-tone-neutral-fg',
        chipFilled: 'bg-tone-neutral/10 text-tone-neutral-fg',
        ring: 'ring-tone-neutral/30',
        underline: 'bg-tone-neutral',
        icon: Shield,
      };
    default:
      return {
        text: 'text-fg/60',
        chipFilled: 'bg-fg/10 text-fg/60',
        ring: 'ring-fg/30',
        underline: 'bg-fg/40',
        icon: Shield,
      };
  }
}

// Outdated bump severity. Major = warning (real upgrade work), minor =
// info (worth batching), patch = success (free wins). Same token system
// as `severityTone`, just a different mapping.
export function bumpTone(b: BumpGroup): Tone & { label: string } {
  switch (b) {
    case 'major':
      return {
        text: 'text-tone-warning-fg',
        chipFilled: 'bg-tone-warning/15 text-tone-warning-fg',
        ring: 'ring-tone-warning/45',
        underline: 'bg-tone-warning',
        icon: Package,
        label: 'Major',
      };
    case 'minor':
      return {
        text: 'text-tone-info-fg',
        chipFilled: 'bg-tone-info/12 text-tone-info-fg',
        ring: 'ring-tone-info/40',
        underline: 'bg-tone-info',
        icon: Package,
        label: 'Minor',
      };
    case 'patch':
      return {
        text: 'text-tone-success-fg',
        chipFilled: 'bg-tone-success/12 text-tone-success-fg',
        ring: 'ring-tone-success/40',
        underline: 'bg-tone-success',
        icon: Package,
        label: 'Patch',
      };
    default:
      return {
        text: 'text-fg/55',
        chipFilled: 'bg-fg/10 text-fg/55',
        ring: 'ring-fg/30',
        underline: 'bg-fg/40',
        icon: Package,
        label: 'Other',
      };
  }
}

// ---- Scan freshness formatter -------------------------------------------

export function scanFreshness(at: number | null): string {
  if (at == null) return 'Never scanned';
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return 'Scanned just now';
  if (diff < 3_600_000) return `Scanned ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Scanned ${Math.floor(diff / 3_600_000)}h ago`;
  return `Scanned ${Math.floor(diff / 86_400_000)}d ago`;
}

// ---- Upgrade command helpers -------------------------------------------

export function upgradeCommandForAdvisory(runtime: string | null, a: Advisory): string | null {
  // Only pin to fix_version when it looks like a plain semver — ranges
  // like ">=2.3.4" don't translate cleanly into `@x.y.z` for the
  // package manager, so we fall back to @latest.
  const pinned = a.fix_version && /^\d+(\.\d+){0,2}$/.test(a.fix_version) ? a.fix_version : null;
  return upgradeCommand(runtime, a.package, pinned);
}

export function upgradeCommandForOutdated(
  runtime: string | null,
  p: OutdatedPackage,
): string | null {
  const pinned = p.latest && /^\d+(\.\d+){0,2}(-[\w.]+)?$/.test(p.latest) ? p.latest : null;
  return upgradeCommand(runtime, p.name, pinned);
}

/**
 * Build the most-likely upgrade command for a package given the project's
 * detected runtime. Returns `null` for runtimes we can't confidently
 * generate for — better silence than a misleading `yarn upgrade` on a
 * pnpm repo.
 *
 * These commands are intentionally *conservative*: they upgrade the
 * specific package and leave the lockfile resolver to do the right thing.
 * A full `npm audit fix --force` could cascade breaking changes, which is
 * a decision the user should make, not a button.
 */
function upgradeCommand(
  runtime: string | null,
  pkg: string,
  version?: string | null,
): string | null {
  if (!pkg) return null;
  const target = version ? `${pkg}@${version}` : `${pkg}@latest`;
  switch (runtime) {
    case 'node':
    case 'npm':
      return `npm install ${target}`;
    case 'pnpm':
      return version ? `pnpm update ${pkg}@${version}` : `pnpm update ${pkg} --latest`;
    case 'yarn':
      return `yarn up ${target}`;
    case 'bun':
      return `bun update ${target}`;
    case 'rust':
    case 'cargo':
      return version ? `cargo add ${pkg}@${version}` : `cargo update -p ${pkg}`;
    case 'go':
      return `go get ${pkg}@${version ?? 'latest'}`;
    case 'python':
    case 'pip':
      return version ? `pip install --upgrade ${pkg}==${version}` : `pip install --upgrade ${pkg}`;
    case 'poetry':
      return version ? `poetry add ${pkg}@${version}` : `poetry update ${pkg}`;
    case 'uv':
      return version
        ? `uv pip install --upgrade ${pkg}==${version}`
        : `uv pip install --upgrade ${pkg}`;
    default:
      return null;
  }
}

// ---- Registry fallback --------------------------------------------------

/**
 * When the scanner didn't find an explicit `homepage` (common for npm when
 * the package.json omits it), fall back to the npm registry page for the
 * name. Better UX than a dead icon, and the registry page always has the
 * changelog link + the README.
 */
export function registryFallbackUrl(name: string): string | null {
  if (!name) return null;
  return `https://www.npmjs.com/package/${name}`;
}

// ---- Filtering & sorting ------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const BUMP_RANK: Record<BumpGroup, number> = {
  major: 0,
  minor: 1,
  patch: 2,
  other: 3,
};

export function filterAndSortAdvisories(
  items: Advisory[],
  query: string,
  severityFilter: Severity | 'all',
): Advisory[] {
  const q = query.trim().toLowerCase();
  const out: Advisory[] = [];
  for (const a of items) {
    const sev = (SEVERITY_ORDER as readonly string[]).includes(a.severity)
      ? (a.severity as Severity)
      : 'low';
    if (severityFilter !== 'all' && sev !== severityFilter) continue;
    if (q) {
      const hay = `${a.package} ${a.id ?? ''} ${a.title}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(a);
  }
  out.sort((a, b) => {
    const ra =
      SEVERITY_RANK[(a.severity as Severity) in SEVERITY_RANK ? (a.severity as Severity) : 'low'];
    const rb =
      SEVERITY_RANK[(b.severity as Severity) in SEVERITY_RANK ? (b.severity as Severity) : 'low'];
    if (ra !== rb) return ra - rb;
    return a.package.localeCompare(b.package);
  });
  return out;
}

export function filterAndSortOutdated(
  items: OutdatedPackage[],
  query: string,
  bumpFilter: BumpGroup | 'all',
): OutdatedPackage[] {
  const q = query.trim().toLowerCase();
  const out: OutdatedPackage[] = [];
  for (const p of items) {
    const key = (p.bump as BumpGroup | null) ?? 'other';
    const group: BumpGroup = (BUMP_ORDER as readonly string[]).includes(key) ? key : 'other';
    if (bumpFilter !== 'all' && group !== bumpFilter) continue;
    if (q) {
      const hay = `${p.name} ${p.current} ${p.latest}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(p);
  }
  out.sort((a, b) => {
    const ka = ((a.bump as BumpGroup | null) ?? 'other') as BumpGroup;
    const kb = ((b.bump as BumpGroup | null) ?? 'other') as BumpGroup;
    const ra = BUMP_RANK[(ka in BUMP_RANK ? ka : 'other') as BumpGroup];
    const rb = BUMP_RANK[(kb in BUMP_RANK ? kb : 'other') as BumpGroup];
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ---- Row key helpers ----------------------------------------------------

export function advisoryKey(a: Advisory, idx: number): string {
  return `${a.package}::${a.id ?? ''}::${idx}`;
}

export function outdatedKey(p: OutdatedPackage): string {
  return `${p.name}::${p.current}`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Utils --------------------------------------------------------------
