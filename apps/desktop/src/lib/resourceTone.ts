/** Traffic-light tinting for CPU. Thresholds are per-core (sysinfo reports
 *  100% = one fully used core), so a dev server pegging one core still
 *  stands out on an 8-core machine — that's usually what the user wants
 *  to notice. Idle stays in a quiet muted tone so the badge reads as
 *  "active" without competing with the status dot for attention. */
export function cpuToneClass(cpuPercent: number): string {
  if (cpuPercent >= 80) return 'text-status-error';
  if (cpuPercent >= 40) return 'text-status-starting';
  if (cpuPercent >= 5) return 'text-accent';
  return 'text-fg-muted';
}

/** RAM tinting — escalate by absolute footprint. A 50 MB shell is
 *  unremarkable; a 2 GB Electron dev server is worth flagging. Uses green
 *  at normal sizes to stay visually distinct from CPU's accent palette so
 *  the two numbers are separable at a glance. */
export function memoryToneClass(memoryBytes: number): string {
  const mb = memoryBytes / (1024 * 1024);
  if (mb >= 2048) return 'text-status-error';
  if (mb >= 512) return 'text-status-starting';
  if (mb >= 1) return 'text-status-running';
  return 'text-fg-muted';
}
