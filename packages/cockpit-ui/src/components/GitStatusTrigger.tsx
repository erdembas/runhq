'use client';

import { ArrowDown, ArrowUp, GitBranch } from 'lucide-react';
import type { GitStatus } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';

interface GitStatusTriggerProps {
  git: GitStatus | undefined;
  open: boolean;
  compact?: boolean;
  onToggle: () => void;
  onOpenDiff: () => void;
}

/**
 * Pure-presentational git status chip — the visual surface only.
 *
 * The full `GitStatusChip` in apps/desktop wraps this trigger with an
 * IPC-driven popover (branch list, recent commits, stash, push/pull).
 * The popover stays in the desktop tree because every action is a
 * Tauri round-trip; the trigger lives here so both desktop and the
 * marketing site (with mock fixtures) render the identical chip.
 */
export function GitStatusTrigger({
  git,
  open,
  compact,
  onToggle,
  onOpenDiff,
}: GitStatusTriggerProps) {
  if (git === undefined) {
    return (
      <div
        className={cn(
          'border-border bg-surface-muted/70 text-fg-dim rounded-app-sm flex items-center gap-1.5 border px-2 text-[12px]',
          compact ? 'h-6' : 'h-7',
        )}
      >
        <GitBranch className="h-3 w-3" />
        {!compact && <span>…</span>}
      </div>
    );
  }

  const { branch, ahead, behind, is_dirty, dirty_count, head_short } = git;

  return (
    <button
      type="button"
      onClick={onToggle}
      title={branch ? `Branch: ${branch}` : 'Detached HEAD'}
      className={cn(
        'border-border rounded-app-sm flex items-center gap-1 border font-medium transition',
        compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 gap-1.5 px-2 text-[12px]',
        open
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'bg-surface-muted/70 text-fg-muted hover:text-fg hover:bg-surface-overlay',
      )}
    >
      <GitBranch
        className={cn(compact ? 'h-3 w-3' : 'h-3 w-3', open ? 'text-accent' : 'text-fg-dim')}
      />
      <span className={cn('truncate', compact ? 'max-w-[100px]' : 'max-w-[140px]')}>
        {branch ?? (head_short ? `(${head_short})` : 'detached')}
      </span>
      {ahead > 0 && (
        <span className="text-status-running inline-flex items-center tabular-nums">
          <ArrowUp className={compact ? 'h-2.5 w-2.5' : 'h-2.5 w-2.5'} />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="text-status-starting inline-flex items-center tabular-nums">
          <ArrowDown className={compact ? 'h-2.5 w-2.5' : 'h-2.5 w-2.5'} />
          {behind}
        </span>
      )}
      {is_dirty && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDiff();
          }}
          className="bg-status-starting/80 hover:bg-status-starting ml-0.5 h-1.5 w-1.5 rounded-full"
          title={`${dirty_count} changed file${dirty_count === 1 ? '' : 's'} — click to view diff`}
          aria-label={`${dirty_count} uncommitted changes — view diff`}
        />
      )}
    </button>
  );
}
