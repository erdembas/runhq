import { number } from '../i18n/core';
/** Human-readable byte formatting — binary prefixes (KiB/MiB) because that's
 *  what OS process inspectors (Activity Monitor, Task Manager, `ps` on linux)
 *  report, and users comparing RunHQ's numbers to those tools expect them
 *  to line up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / 1024 ** exp;
  // Show one decimal under 10 (e.g. 4.2 GB) and whole numbers above so the
  // badge width stays predictable without clamping.
  const formatted =
    value >= 10 || exp === 0
      ? number(Math.round(value))
      : number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${formatted} ${units[exp]}`;
}

/** Compact percentage with a single decimal under 10 — same rationale as
 *  `formatBytes`: width consistency for dashboard chips and sparkline
 *  overlays. */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) return '0%';
  if (percent >= 10) return `${number(Math.round(percent))}%`;
  return `${number(percent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
