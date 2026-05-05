import {
  AlertTriangle,
  GitCommit,
  GitMerge,
  PlayCircle,
  Square as SquareIcon,
  Skull,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '@runhq/cockpit-types';
import { cn } from '../lib/cn';

interface Props {
  events: TimelineEvent[];
  className?: string;
}

const ICON: Record<TimelineEventType, LucideIcon> = {
  service_started: PlayCircle,
  service_stopped: SquareIcon,
  service_crashed: Skull,
  git_commit: GitCommit,
  git_push: GitMerge,
  git_pull: GitMerge,
  git_checkout: GitMerge,
  git_branch_created: GitMerge,
  git_stash: GitMerge,
  log_error: AlertTriangle,
  log_warning: AlertTriangle,
  file_changed: GitCommit,
};

const TONE: Record<TimelineEventType, string> = {
  service_started: 'text-status-running',
  service_stopped: 'text-fg-muted',
  service_crashed: 'text-status-error',
  git_commit: 'text-accent',
  git_push: 'text-status-running',
  git_pull: 'text-status-running',
  git_checkout: 'text-fg-muted',
  git_branch_created: 'text-accent',
  git_stash: 'text-fg-muted',
  log_error: 'text-status-error',
  log_warning: 'text-status-starting',
  file_changed: 'text-fg-muted',
};

/**
 * Marketing-grade activity timeline. Same vertical thread + icon
 * spine as apps/desktop's `ActivityTimeline`, but stripped of the
 * grouping, infinite scroll, and live SQLite polling layers — the
 * marketing site only ever shows a handful of curated fixture
 * events, so the heavy machinery is dead weight here.
 */
export function ActivityTimeline({ events, className }: Props) {
  return (
    <ol className={cn('relative flex flex-col gap-3 pl-5', className)}>
      <span
        aria-hidden
        className="border-border absolute top-1 bottom-1 left-[6px] border-l border-dashed"
      />
      {events.map((evt) => {
        const Icon = ICON[evt.event_type] ?? GitCommit;
        return (
          <li key={evt.id} className="relative flex items-start gap-3">
            <span
              className={cn(
                'border-border bg-surface relative -left-[6px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                TONE[evt.event_type],
              )}
            >
              <Icon className="h-2.5 w-2.5" />
            </span>
            <div className="-mt-0.5 min-w-0 flex-1">
              <div className="text-fg flex items-baseline gap-2 text-[12.5px]">
                <span className="truncate">{evt.description}</span>
              </div>
              <div className="text-fg-dim flex items-center gap-1.5 text-[10.5px]">
                {evt.service_name && <span className="truncate">{evt.service_name}</span>}
                {evt.service_name && <span aria-hidden>·</span>}
                <time>{evt.timestamp}</time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
