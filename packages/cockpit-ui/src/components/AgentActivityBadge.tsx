'use client';

import { Bot, CheckCheck, CircleAlert, Square } from 'lucide-react';
import { agentActivityLabel, type AgentActivitySummary } from '../lib/agentActivity';
import { cn } from '../lib/cn';

const countLabel = (count: number) => (count > 99 ? '99+' : count);

/** Compact, fixed-width activity counts shared by sidebar rows and navigation. */
export function AgentActivityBadge({
  activity,
  name,
  compact = false,
  onClick,
  className,
}: {
  activity: AgentActivitySummary;
  name: string;
  compact?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const active = activity.working + activity.starting;
  const attention = activity.waiting + activity.issues;
  const label = agentActivityLabel(activity);
  if (!label) return null;
  const compactCount = active || attention || activity.unread || activity.stopping;
  const PrimaryIcon = active
    ? Bot
    : attention
      ? CircleAlert
      : activity.unread
        ? CheckCheck
        : Square;
  const primaryTone = active
    ? 'text-status-running'
    : attention
      ? 'text-tone-warning'
      : activity.unread
        ? 'text-tone-info'
        : 'text-fg-dim';
  return (
    <button
      type="button"
      data-agent-activity
      title={`${name} agents: ${label}. Open task.`}
      aria-label={`${name} agents: ${label}. Open task.`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        'focus-visible:ring-accent/50 inline-flex shrink-0 items-center rounded-md text-[9px] font-medium tabular-nums outline-none focus-visible:ring-2',
        compact
          ? 'bg-surface-raised border-border h-4 min-w-5 justify-center border px-0.5'
          : 'hover:bg-fg/5 h-6 w-[58px] justify-end gap-0.5 px-1 transition-colors',
        className,
      )}
    >
      {compact ? (
        <span className="relative inline-flex min-w-4 items-center justify-center">
          <span
            className={cn(
              active
                ? 'text-status-running motion-safe:animate-pulse'
                : attention
                  ? 'text-tone-warning'
                  : activity.unread
                    ? 'text-tone-info'
                    : 'text-fg-dim',
            )}
          >
            {countLabel(compactCount)}
          </span>
          {active > 0 && attention > 0 && (
            <span
              aria-hidden
              className="bg-tone-warning absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full"
            />
          )}
          {(active > 0 || attention > 0) && activity.unread > 0 && (
            <span
              aria-hidden
              className="bg-tone-info absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full"
            />
          )}
        </span>
      ) : (
        <>
          <span
            className={cn('inline-flex w-[26px] items-center justify-center gap-0.5', primaryTone)}
          >
            <PrimaryIcon
              aria-hidden
              className={cn('h-3 w-3 shrink-0', active > 0 && 'motion-safe:animate-pulse')}
            />
            <span>{countLabel(compactCount)}</span>
          </span>
          <span
            className={cn(
              'text-tone-warning inline-flex w-2.5 items-center justify-center',
              !(active && attention) && 'invisible',
            )}
          >
            <CircleAlert aria-hidden className="h-2.5 w-2.5 shrink-0" />
          </span>
          <span
            className={cn(
              'text-tone-info inline-flex w-2.5 items-center justify-center',
              !((active || attention) && activity.unread) && 'invisible',
            )}
          >
            <CheckCheck aria-hidden className="h-2.5 w-2.5 shrink-0" />
          </span>
        </>
      )}
    </button>
  );
}
