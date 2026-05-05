import { Cpu, MemoryStick } from 'lucide-react';
import type { ResourceSample } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';
import { formatBytes, formatPercent } from '../lib/format';
import { cpuToneClass, memoryToneClass } from '../lib/resourceTone';

interface Props {
  sample: ResourceSample | undefined;
  /** Compact (sidebar row) variant drops the icons so the badge can fit
   *  next to port/runtime chips without wrapping on narrow sidebars. */
  compact?: boolean;
  className?: string;
}

/** Uniform CPU+RAM pill used across the dashboard, sidebar, and status bar.
 *  Renders `—` for services without a sample yet so the slot doesn't shift
 *  width when the first resource event arrives 2 seconds in. */
export function ResourceBadge({ sample, compact = false, className }: Props) {
  const cpu = sample?.cpu_percent;
  const mem = sample?.memory_bytes;
  const cpuTone = cpuToneClass(cpu ?? 0);
  const memTone = memoryToneClass(mem ?? 0);

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 font-mono text-[10.5px] tabular-nums',
          className,
        )}
        title={
          sample
            ? `CPU ${formatPercent(cpu!)} · RSS ${formatBytes(mem!)}`
            : 'Waiting for first sample…'
        }
      >
        <span className={cn('tabular-nums', cpuTone)}>{sample ? formatPercent(cpu!) : '—'}</span>
        <span className="text-fg-dim/40">·</span>
        <span className={cn('tabular-nums', memTone)}>{sample ? formatBytes(mem!) : '—'}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-mono text-[10.5px] tabular-nums',
        className,
      )}
    >
      <span className={cn('inline-flex items-center gap-1', cpuTone)}>
        <Cpu className="h-3 w-3" />
        {sample ? formatPercent(cpu!) : '—'}
      </span>
      <span className={cn('inline-flex items-center gap-1', memTone)}>
        <MemoryStick className="h-3 w-3" />
        {sample ? formatBytes(mem!) : '—'}
      </span>
    </span>
  );
}
