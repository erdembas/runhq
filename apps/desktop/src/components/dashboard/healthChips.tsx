import * as i18n from '@runhq/cockpit-ui/i18n';
import { Package, Scale, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AuditResult, LicenseScanSummary, OutdatedResult } from '@/types';

/**
 * Shared "what's wrong with this service?" chip primitives.
 *
 * Why a shared module? These chips show up in three places — the
 * dashboard `ServiceCard` health strip, the per-service `LogPanel`
 * header, and (downstream) the right-rail attention surfaces. They
 * all need the *same* tone ladder, magnitude, tooltip wording and
 * click semantics, because the user pattern-matches on chip shape:
 * a red Scale icon should mean "license contamination, click here"
 * regardless of whether it sits on a card or above a log stream.
 *
 * Each component follows the same design contract:
 *   • Icon carries the *domain* (📦 = deps, 🛡 = CVE, ⚖ = license).
 *   • Number carries the *magnitude*. Tabular-nums keeps columns tidy
 *     when several chips line up next to each other.
 *   • Colour carries the *severity*. Tokens auto-flip light/dark.
 *   • Tooltip carries the *breakdown*. Chip face stays compact so a
 *     row of them survives ~150px of horizontal space.
 *   • Hidden when the corresponding bucket is empty — a clean tree
 *     should render *no* chip, not a green "0".
 */

/**
 * How many "ship-tonight" license contaminations does this project
 * carry?
 *
 * Sums strong copyleft (GPL family, excluding LGPL), network
 * copyleft (AGPL/SSPL), and proprietary licenses. Weak copyleft
 * (LGPL/MPL/EPL) and unknown are deliberately excluded — they show
 * up in the drawer's full table but shouldn't push a card into the
 * critical chip surface, because they don't trigger the same
 * "your tree is now copyleft" outcome.
 *
 * Co-located with the chip components on purpose: every consumer that
 * reads this count also renders a {@link LicenseChip} from this file,
 * so keeping them next to each other prevents the count and the chip
 * tone ladder from drifting apart in two separate modules.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function licenseContaminationCount(license: LicenseScanSummary | null | undefined): number {
  if (!license) return 0;
  return license.strong_copyleft_count + license.network_copyleft_count + license.proprietary_count;
}

/**
 * Dependency-freshness chip.
 *
 * Tone ladder: major bump → warning, minor → info, patch-only →
 * success (the visual reward is intentional — patch-only outdated
 * is "clean enough to ship today, fix at leisure").
 */
export function OutdatedChip({
  outdated,
  onClick,
}: {
  outdated: OutdatedResult;
  onClick: () => void;
}) {
  i18n.useLocale();
  if (outdated.total === 0) return null;
  const tone =
    outdated.major > 0
      ? 'bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25 border-tone-warning/30'
      : outdated.minor > 0
        ? 'bg-tone-info/12 text-tone-info-fg hover:bg-tone-info/22 border-tone-info/30'
        : 'bg-tone-success/12 text-tone-success-fg hover:bg-tone-success/22 border-tone-success/30';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={i18n.t(
        '{value1} outdated: {value2} major, {value3} minor, {value4} patch — click for details',
        {
          value1: outdated.total,
          value2: outdated.major,
          value3: outdated.minor,
          value4: outdated.patch,
        },
      )}
      aria-label={i18n.t('{value1} outdated dependencies', { value1: outdated.total })}
      className={cn(
        'rounded-app-sm inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold tabular-nums transition',
        tone,
      )}
    >
      <Package className="h-3 w-3" />
      {outdated.total}
    </button>
  );
}

/**
 * CVE/audit chip.
 *
 * Tone ladder: critical → critical (red, *with pulse ring* — security
 * criticality must outbid neighbouring elements like port badges),
 * high → warning, medium → info, low-only → neutral.
 */
export function AuditChip({ audit, onClick }: { audit: AuditResult; onClick: () => void }) {
  i18n.useLocale();
  const total = audit.critical + audit.high + audit.medium + audit.low;
  if (total === 0) return null;
  const hasCritical = audit.critical > 0;
  const tone = hasCritical
    ? 'bg-tone-critical/18 text-tone-critical-fg hover:bg-tone-critical/28 border-tone-critical/35'
    : audit.high > 0
      ? 'bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25 border-tone-warning/30'
      : audit.medium > 0
        ? 'bg-tone-info/12 text-tone-info-fg hover:bg-tone-info/22 border-tone-info/30'
        : 'bg-tone-neutral/10 text-tone-neutral-fg hover:bg-tone-neutral/20 border-tone-neutral/25';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={i18n.t(
        '{total} advisories: {value2} critical, {value3} high, {value4} medium, {value5} low — click for details',
        {
          total: total,
          value2: audit.critical,
          value3: audit.high,
          value4: audit.medium,
          value5: audit.low,
        },
      )}
      aria-label={i18n.t('{total} security advisories', { total: total })}
      className={cn(
        'rounded-app-sm relative inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold tabular-nums transition',
        tone,
        hasCritical && 'shadow-[0_0_0_1px_rgb(239_68_68/0.2),0_0_12px_-2px_rgb(239_68_68/0.6)]',
      )}
    >
      <Shield className="h-3 w-3" />
      {total}
    </button>
  );
}

/**
 * License-contamination chip.
 *
 * Tone ladder, hottest first:
 *   - network copyleft ≥ 1 → critical pulse (AGPL / SSPL — the most
 *                            commercially toxic class for SaaS).
 *   - strong copyleft  ≥ 1 → critical (GPL family — linking infects
 *                            the consumer).
 *   - proprietary      ≥ 1 → warning (commercial licenses; verify
 *                            terms but no automatic infection).
 *
 * Click typically opens the per-service `LicensePanel` overlay where
 * the authoritative full dependency table + THIRD-PARTY-NOTICES.md
 * generator live; this chip is the "noticing" surface.
 */
export function LicenseChip({
  license,
  onClick,
}: {
  license: LicenseScanSummary;
  onClick: () => void;
}) {
  i18n.useLocale();
  const total = licenseContaminationCount(license);
  if (total === 0) return null;
  const hasNetwork = license.network_copyleft_count > 0;
  const hasStrong = license.strong_copyleft_count > 0;
  const hasCritical = hasNetwork || hasStrong;
  const tone = hasCritical
    ? 'bg-tone-critical/18 text-tone-critical-fg hover:bg-tone-critical/28 border-tone-critical/35'
    : 'bg-tone-warning/15 text-tone-warning-fg hover:bg-tone-warning/25 border-tone-warning/30';

  const parts: string[] = [];
  if (license.network_copyleft_count > 0) {
    parts.push(
      i18n.t('{value1} network copyleft (AGPL/SSPL)', { value1: license.network_copyleft_count }),
    );
  }
  if (license.strong_copyleft_count > 0) {
    parts.push(i18n.t('{value1} strong copyleft (GPL)', { value1: license.strong_copyleft_count }));
  }
  if (license.proprietary_count > 0) {
    parts.push(i18n.t('{value1} proprietary', { value1: license.proprietary_count }));
  }
  const tooltip = i18n.t(
    'License contamination: {value1}. Click to review and generate THIRD-PARTY-NOTICES.md.',
    { value1: parts.join(', ') },
  );

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={tooltip}
      aria-label={i18n.t('{total} contaminated licenses', { total: total })}
      className={cn(
        'rounded-app-sm relative inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold tabular-nums transition',
        tone,
        hasNetwork && 'shadow-[0_0_0_1px_rgb(239_68_68/0.2),0_0_12px_-2px_rgb(239_68_68/0.6)]',
      )}
    >
      <Scale className="h-3 w-3" />
      {total}
    </button>
  );
}
