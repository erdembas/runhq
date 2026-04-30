import { ChevronDown, Flame, Package, ShieldAlert, Clock, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { riskScore } from '@/lib/risk';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import type { ProjectOverview } from '@/types';
import type { DetailTab } from '@/components/ProjectDetailDrawer';

/**
 * "Worst offenders" band — the short list of projects that most urgently
 * need attention. Sits below the KPI tiles and above the card roster
 * so a fresh-open user flow reads:
 *
 *   1. Glance at KPIs → "do we have a CVE problem?"
 *   2. Glance at offenders → "which 2-3 projects?"
 *   3. Click one → drawer opens on the appropriate tab, fix in place
 *
 * Without this band, the user has to visually hunt for the coloured
 * chip across 20+ cards, which defeats the dashboard's "bird's-eye"
 * promise from the ROADMAP. The band makes the critical 20% jump to
 * the top regardless of sort/filter state.
 *
 * Renders nothing when all scores are zero — a clean portfolio
 * shouldn't eat vertical space announcing its cleanness.
 */
interface OffenderEntry {
  project: ProjectOverview;
  score: number;
  /** Which tab to land on when the row is clicked (worst axis first). */
  primaryTab: DetailTab;
  /** Short reason string rendered on the right of the row. */
  reason: string;
}

/**
 * Composite risk score.
 *
 * Weights reflect user-facing urgency, not raw numerical severity:
 *   • A single critical CVE ranks a project higher than 10 major
 *     version bumps — you *ship tonight* for the CVE, you *plan next
 *     sprint* for the bumps.
 *   • Stale adds a flat penalty: stale projects with any issues are
 *     worse than active projects with the same issues (nobody's
 *     watching, so rot accumulates).
 *   • Dirty is intentionally *not* part of the score — a dirty
 *     working tree is a developer-choice, not a portfolio problem.
 *     It's surfaced via its own KPI tile / pill.
 */
function pickPrimaryTab(p: ProjectOverview): DetailTab {
  const hasCritOrHigh = p.audit != null && (p.audit.critical > 0 || p.audit.high > 0);
  if (hasCritOrHigh) return 'advisories';
  // Anything else that surfaces here (low CVEs, outdated, stale) is
  // most usefully surfaced on the Outdated tab — medium/low CVEs still
  // live inside the audit payload but the drawer will jump to the
  // advisories tab anyway via the tab header chip counts.
  return 'outdated';
}

function describe(p: ProjectOverview): string {
  const audit = p.audit;
  const outdated = p.outdated;
  const license = p.license;
  const parts: string[] = [];
  if (audit && audit.critical > 0) {
    parts.push(`${audit.critical} critical`);
  } else if (audit && audit.high > 0) {
    parts.push(`${audit.high} high`);
  }
  if (outdated && outdated.major > 0) {
    parts.push(`${outdated.major} major bump${outdated.major > 1 ? 's' : ''}`);
  } else if (outdated && outdated.total > 0) {
    parts.push(`${outdated.total} outdated`);
  }
  // License contamination — surface the "loudest" class first so the
  // reason line reads at a glance: AGPL beats GPL beats proprietary.
  // We only emit one license fragment per row to keep the line
  // scannable; the breakdown is one click away in the LicensePanel.
  if (license) {
    if (license.network_copyleft_count > 0) {
      parts.push(
        `${license.network_copyleft_count} AGPL${license.network_copyleft_count > 1 ? 's' : ''}`,
      );
    } else if (license.strong_copyleft_count > 0) {
      parts.push(
        `${license.strong_copyleft_count} GPL${license.strong_copyleft_count > 1 ? 's' : ''}`,
      );
    } else if (license.proprietary_count > 0) {
      parts.push(
        `${license.proprietary_count} proprietary lic${license.proprietary_count > 1 ? 's' : '.'}`,
      );
    }
  }
  if (p.is_stale) parts.push('stale');
  return parts.join(' · ');
}

export function WorstOffenders({
  projects,
  onOpenDetail,
  limit = 5,
}: {
  projects: ProjectOverview[];
  onOpenDetail: (serviceId: string, tab: DetailTab) => void;
  limit?: number;
}) {
  const offenders: OffenderEntry[] = [];
  for (const p of projects) {
    const score = riskScore(p);
    if (score <= 0) continue;
    offenders.push({
      project: p,
      score,
      primaryTab: pickPrimaryTab(p),
      reason: describe(p),
    });
  }
  offenders.sort((a, b) => b.score - a.score);
  const shown = offenders.slice(0, limit);
  const worst = shown[0];
  if (!worst) return null;

  // Determine band tone — the first row's severity drives the band
  // accent so a portfolio with any critical CVE gets a red tint, not
  // just the row itself.
  const hasCritical = (worst.project.audit?.critical ?? 0) > 0;
  const hasHigh = (worst.project.audit?.high ?? 0) > 0;
  // Band tint matches the worst row's severity. Tones come from the
  // semantic palette so the soft tint reads correctly on both ivory
  // and charcoal — `tone-warning` for high replaces the old hard-coded
  // orange-500 wash that visually disappeared on light mode.
  const accent = hasCritical
    ? 'border-status-error/30 bg-status-error/[0.04]'
    : hasHigh
      ? 'border-tone-warning/30 bg-tone-warning/[0.05]'
      : 'border-border';

  return (
    <WorstOffendersInner
      accent={accent}
      hasCritical={hasCritical}
      hasHigh={hasHigh}
      shown={shown}
      totalCount={offenders.length}
      onOpenDetail={onOpenDetail}
    />
  );
}

/**
 * Inner component so the collapse hook lives below the early-return
 * guard above (no offenders → no section, no hook). Splitting also
 * makes the persistent-bool key colocated with its consumer.
 */
function WorstOffendersInner({
  accent,
  hasCritical,
  hasHigh,
  shown,
  totalCount,
  onOpenDetail,
}: {
  accent: string;
  hasCritical: boolean;
  hasHigh: boolean;
  shown: OffenderEntry[];
  totalCount: number;
  onOpenDetail: (serviceId: string, tab: DetailTab) => void;
}) {
  // Collapse state survives navigation / restart so a user who's
  // habitually closed the offender band keeps it closed. Default
  // open — the band only renders when there are real offenders, so
  // hiding it by default would defeat its purpose.
  const [collapsed, setCollapsed] = usePersistentBoolean(
    'runhq.dashboard.offenders.collapsed',
    false,
  );
  return (
    <section
      className={cn('rounded-app overflow-hidden border transition', accent)}
      aria-label="Projects needing attention"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="dashboard-offenders-list"
        className="border-border/60 hover:bg-fg/5 flex w-full items-center gap-2 border-b px-4 py-2 text-left transition"
        title={collapsed ? 'Expand the attention list' : 'Collapse the attention list'}
      >
        <Flame
          className={cn(
            'h-3.5 w-3.5',
            hasCritical ? 'text-status-error' : hasHigh ? 'text-tone-warning-fg' : 'text-fg-dim',
          )}
        />
        <span className="text-fg-dim text-[11px] font-semibold tracking-[0.12em] uppercase">
          Needs attention
        </span>
        <span className="text-fg-dim text-[11px] tabular-nums">
          {shown.length} of {totalCount}
        </span>
        <ChevronDown
          className={cn(
            'text-fg-dim ml-auto h-3.5 w-3.5 shrink-0 transition-transform',
            collapsed && '-rotate-90',
          )}
          aria-hidden
        />
      </button>
      {!collapsed && (
        <ul id="dashboard-offenders-list" className="divide-border/60 divide-y">
          {shown.map((entry) => (
            <OffenderRow key={entry.project.service_id} entry={entry} onOpenDetail={onOpenDetail} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Single row — the click targets are deliberately layered:
 *
 *   • The *row* (name, reason, arrow) is a role="button" div that
 *     opens `primaryTab` (the "worst axis" for this project). This
 *     gives a "just click anywhere" fast path.
 *   • The *CVE chip* is an actual <button> that opens `advisories`,
 *     regardless of what the row's primaryTab is — the user is
 *     expressing explicit intent ("show me the vulns").
 *   • The *outdated chip* is a <button> that opens `outdated`.
 *   • The *stale badge* routes to `primaryTab` (no dedicated tab
 *     exists for staleness; the row-level intent is the best answer).
 *
 * We use a div + role="button" (not a <button>) for the row container
 * so chip <button>s can nest validly. Chip buttons call
 * `stopPropagation` to prevent the row handler from firing twice
 * and (worse) racing which tab wins.
 */
function OffenderRow({
  entry,
  onOpenDetail,
}: {
  entry: OffenderEntry;
  onOpenDetail: (serviceId: string, tab: DetailTab) => void;
}) {
  const { project: p, primaryTab, reason } = entry;
  const cveTotal =
    (p.audit?.critical ?? 0) + (p.audit?.high ?? 0) + (p.audit?.medium ?? 0) + (p.audit?.low ?? 0);
  const hasCritical = (p.audit?.critical ?? 0) > 0;
  const outTotal = p.outdated?.total ?? 0;
  const openRow = () => onOpenDetail(p.service_id, primaryTab);
  const openTab = (tab: DetailTab) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDetail(p.service_id, tab);
  };
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={openRow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openRow();
          }
        }}
        className="group/row hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition outline-none"
      >
        <span className="text-fg flex-1 truncate text-[13px] font-semibold">{p.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {cveTotal > 0 && (
            <button
              type="button"
              onClick={openTab('advisories')}
              title={`${cveTotal} advisor${cveTotal > 1 ? 'ies' : 'y'} — view advisories`}
              aria-label={`${cveTotal} security advisories, open advisories tab`}
              className={cn(
                'rounded-app-sm inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold tabular-nums transition',
                hasCritical
                  ? 'border-tone-critical/35 bg-tone-critical/15 text-tone-critical-fg hover:bg-tone-critical/25'
                  : (p.audit?.high ?? 0) > 0
                    ? 'border-tone-warning/30 bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25'
                    : 'border-tone-info/30 bg-tone-info/12 text-tone-info-fg hover:bg-tone-info/22',
              )}
            >
              <ShieldAlert className="h-3 w-3" />
              {cveTotal}
            </button>
          )}
          {outTotal > 0 && (
            <button
              type="button"
              onClick={openTab('outdated')}
              title={`${outTotal} outdated package${outTotal > 1 ? 's' : ''} — view outdated`}
              aria-label={`${outTotal} outdated packages, open outdated tab`}
              className={cn(
                'rounded-app-sm inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold tabular-nums transition',
                (p.outdated?.major ?? 0) > 0
                  ? 'border-tone-warning/30 bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25'
                  : 'border-tone-info/30 bg-tone-info/12 text-tone-info-fg hover:bg-tone-info/22',
              )}
            >
              <Package className="h-3 w-3" />
              {outTotal}
            </button>
          )}
          {p.is_stale && (
            <button
              type="button"
              onClick={openTab(primaryTab)}
              title={
                p.last_activity
                  ? `No activity since ${new Date(p.last_activity).toLocaleDateString()} — open project`
                  : 'No activity recorded — open project'
              }
              className="bg-fg-dim/10 text-fg-dim hover:bg-fg-dim/20 rounded-app-sm inline-flex h-5 items-center gap-1 px-1.5 text-[10px] font-semibold transition"
            >
              <Clock className="h-3 w-3" />
              Stale
            </button>
          )}
        </div>
        <span className="text-fg-dim hidden w-56 shrink-0 truncate text-right text-[11px] @2xl/main:inline">
          {reason}
        </span>
        <ArrowUpRight className="text-fg-dim group-hover/row:text-accent h-3.5 w-3.5 shrink-0 transition" />
      </div>
    </li>
  );
}
