import type { ProjectOverview } from '@/types';

/**
 * Composite risk score for a project — used by both the Worst Offenders
 * band (ranks the highest-risk projects) and the dashboard's "sort by
 * risk" comparator (ranks within a group / across the roster).
 *
 * Weights reflect user-facing urgency, not raw numerical severity:
 *   • A single critical CVE ranks a project higher than 10 major version
 *     bumps — you *ship tonight* for the CVE, you *plan next sprint* for
 *     the bumps.
 *   • Stale adds a flat penalty only when there's actual risk present —
 *     a dormant project with no CVEs and no outdated deps is just
 *     dormant, not dangerous. Adding a penalty for pure-stale would
 *     misdirect the "sort by risk" reading.
 *   • Dirty is intentionally *not* part of the score — a dirty working
 *     tree is a developer choice, not a portfolio problem. It's
 *     surfaced via its own KPI tile / filter pill.
 *
 * Accepts `undefined` to let callers avoid a null-check boilerplate:
 * a project with no metadata (never scanned, never polled) scores 0.
 */
export function riskScore(p: ProjectOverview | undefined | null): number {
  if (!p) return 0;
  const audit = p.audit;
  const outdated = p.outdated;
  const cve = audit ? audit.critical * 100 + audit.high * 25 + audit.medium * 5 + audit.low * 1 : 0;
  const old = outdated ? outdated.major * 8 + outdated.minor * 2 + outdated.patch * 0.5 : 0;
  const stalePenalty = p.is_stale && cve + old > 0 ? 10 : 0;
  return cve + old + stalePenalty;
}
