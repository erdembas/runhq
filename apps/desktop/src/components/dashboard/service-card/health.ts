import { licenseContaminationCount } from '@/components/dashboard/healthChips';
import type { ProjectOverview } from '@/types';

export function staleLabel(lastActivity: string | null): string {
  if (!lastActivity) return 'Stale';
  try {
    const diffMs = Date.now() - new Date(lastActivity).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'Stale';
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 365) return `${Math.floor(days / 365)}y idle`;
    if (days >= 30) return `${Math.floor(days / 30)}mo idle`;
    if (days >= 7) return `${Math.floor(days / 7)}w idle`;
    return `${days}d idle`;
  } catch {
    return 'Stale';
  }
}

export function countAttentionFlags(p: ProjectOverview | null | undefined): number {
  if (!p) return 0;
  let n = 0;
  if (p.is_stale) n += 1;
  if (p.git_status?.is_dirty) n += 1;
  if (p.outdated && p.outdated.total > 0) n += 1;
  if (p.audit) {
    const total = p.audit.critical + p.audit.high + p.audit.medium + p.audit.low;
    if (total > 0) n += 1;
  }
  if (licenseContaminationCount(p.license) > 0) n += 1;
  return n;
}
