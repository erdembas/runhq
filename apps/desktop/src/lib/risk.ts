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
 *   • License contamination weighs heavily because it's a *legal*
 *     blocker, not a maintenance one. Network copyleft (AGPL/SSPL) is
 *     the most expensive class for a SaaS product (using it triggers
 *     mandatory source disclosure on every web request) so it scores
 *     even higher than strong copyleft (GPL family — only triggers on
 *     redistribution). Proprietary is the softest of the three: it
 *     might just need a paid commercial license, not a re-architecture.
 *   • Stale adds a flat penalty only when there's actual risk present —
 *     a dormant project with no CVEs and no outdated deps is just
 *     dormant, not dangerous. Adding a penalty for pure-stale would
 *     misdirect the "sort by risk" reading.
 *   • Dirty is intentionally *not* part of the score — a dirty working
 *     tree is a developer choice, not a portfolio problem. It's
 *     surfaced via its own KPI tile / filter pill.
 *
 * Weight calibration for the license axis (chosen so the ranking
 * stays intuitive against the existing CVE / outdated weights):
 *   • network copyleft = 80 — between high CVE (25) and critical (100).
 *     One AGPL leak should out-rank a project with a few high CVEs but
 *     stay below a project with an actual unpatched critical.
 *   • strong copyleft  = 50 — same band as "several high CVEs"; a
 *     project shipping under MIT with one GPL transitive dep should
 *     show up above a project carrying many minor outdated bumps but
 *     below a true CVE emergency.
 *   • proprietary      = 15 — between high CVE (25) and medium CVE (5);
 *     reminds the user to check the licence wording without dominating
 *     the band.
 *
 * Accepts `undefined` to let callers avoid a null-check boilerplate:
 * a project with no metadata (never scanned, never polled) scores 0.
 */
export function riskScore(p: ProjectOverview | undefined | null): number {
  if (!p) return 0;
  const audit = p.audit;
  const outdated = p.outdated;
  const license = p.license;
  const cve = audit ? audit.critical * 100 + audit.high * 25 + audit.medium * 5 + audit.low * 1 : 0;
  const old = outdated ? outdated.major * 8 + outdated.minor * 2 + outdated.patch * 0.5 : 0;
  const lic = license
    ? license.network_copyleft_count * 80 +
      license.strong_copyleft_count * 50 +
      license.proprietary_count * 15
    : 0;
  const stalePenalty = p.is_stale && cve + old + lic > 0 ? 10 : 0;
  return cve + old + lic + stalePenalty;
}
