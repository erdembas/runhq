import { cn } from '@/lib/cn';
import type { Status } from '@/types';

const COLOR: Record<Status, string> = {
  running: 'bg-status-running shadow-[0_0_8px_rgb(var(--status-running)/0.55)]',
  starting: 'bg-status-starting animate-pulse',
  stopping: 'bg-status-starting animate-pulse',
  stopped: 'bg-status-stopped',
  exited: 'bg-status-stopped',
  crashed: 'bg-status-error shadow-[0_0_8px_rgb(var(--status-error)/0.55)]',
};

export function StatusDot({
  status,
  size = 'sm',
  className,
}: {
  status: Status;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const sz = size === 'xs' ? 'h-1.5 w-1.5' : size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2';
  return <span className={cn('shrink-0 rounded-full', sz, COLOR[status], className)} />;
}

const PILL: Record<Status, string> = {
  running: 'bg-status-running/15 text-status-running',
  starting: 'bg-status-starting/15 text-status-starting',
  stopping: 'bg-status-starting/15 text-status-starting',
  stopped: 'bg-surface-muted text-fg-muted',
  exited: 'bg-surface-muted text-fg-muted',
  crashed: 'bg-status-error/15 text-status-error',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        'rounded-app-sm inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase',
        PILL[status],
      )}
    >
      <StatusDot status={status} size="xs" />
      {status}
    </span>
  );
}
