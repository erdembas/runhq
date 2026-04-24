import { Circle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { GitStatus } from '@/types';

export function GitStatusBadge({
  git,
  className,
  onClick,
  title,
}: {
  git: GitStatus | null | undefined;
  className?: string;
  /**
   * When provided, the badge renders as an interactive button (used in
   * the Git popover to jump into the diff viewer). Otherwise it's a
   * decorative `<span>` — most callers only want the visual signal.
   */
  onClick?: () => void;
  title?: string;
}) {
  if (git === null || git === undefined) return null;

  const { is_dirty, dirty_count } = git;

  const classes = cn(
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
    is_dirty
      ? 'bg-status-starting/15 text-status-starting'
      : 'bg-status-running/15 text-status-running',
    onClick && is_dirty && 'hover:bg-status-starting/25 cursor-pointer transition',
    onClick && !is_dirty && 'hover:bg-status-running/25 cursor-pointer transition',
    className,
  );

  const content = (
    <>
      <Circle className={cn('h-1.5 w-1.5 fill-current', !is_dirty && 'opacity-60')} aria-hidden />
      {is_dirty ? `${dirty_count} dirty` : 'clean'}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} title={title}>
        {content}
      </button>
    );
  }

  return (
    <span className={classes} title={title}>
      {content}
    </span>
  );
}
