import { cn } from '@/lib/cn';

interface ScanDeltaBadgeProps {
  delta: number;
  severity: 'risk' | 'outdated';
}

export function ScanDeltaBadge({ delta, severity }: ScanDeltaBadgeProps) {
  if (delta === 0) return null;
  const sign = delta > 0 ? '+' : '';
  const isRise = delta > 0;
  const tone =
    severity === 'risk'
      ? isRise
        ? 'bg-tone-danger/15 text-tone-danger-fg'
        : 'bg-tone-success/15 text-tone-success-fg'
      : isRise
        ? 'bg-tone-warning/15 text-tone-warning-fg'
        : 'bg-fg-dim/10 text-fg-dim';
  const abs = Math.abs(delta);
  const noun =
    severity === 'risk'
      ? abs === 1
        ? 'advisory'
        : 'advisories'
      : abs === 1
        ? 'outdated package'
        : 'outdated packages';

  return (
    <span
      className={cn(
        'rounded-app-sm ml-0.5 inline-flex shrink-0 items-center px-1 py-0.5 text-[9px] font-bold tabular-nums',
        tone,
      )}
      title={`${sign}${delta} ${noun} since last scan`}
      aria-label={`${sign}${delta} since last scan`}
    >
      {sign}
      {delta}
    </span>
  );
}
