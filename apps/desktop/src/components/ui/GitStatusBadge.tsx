import { Circle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { GitStatus } from '@/types';

export function GitStatusBadge({
  git,
  className,
}: {
  git: GitStatus | null | undefined;
  className?: string;
}) {
  if (git === null || git === undefined) return null;

  const { is_dirty, dirty_count } = git;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
        is_dirty
          ? 'bg-status-starting/15 text-status-starting'
          : 'bg-status-running/15 text-status-running',
        className,
      )}
    >
      <Circle className={cn('h-1.5 w-1.5 fill-current', !is_dirty && 'opacity-60')} aria-hidden />
      {is_dirty ? `${dirty_count} dirty` : 'clean'}
    </span>
  );
}
