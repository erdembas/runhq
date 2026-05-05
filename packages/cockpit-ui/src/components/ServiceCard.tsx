'use client';

import { ExternalLink, Play, Square, Terminal } from 'lucide-react';
import type {
  GitStatus,
  ProjectOverview,
  ResourceSample,
  ServiceDef,
  Status,
} from '@runhq/cockpit-types';
import { cn } from '../lib/cn';
import { GitStatusTrigger } from './GitStatusTrigger';
import { ResourceBadge } from './ResourceBadge';
import { Sparkline } from './Sparkline';
import { StatusDot } from './StatusDot';

interface Props {
  service: ServiceDef;
  status: Status;
  overview?: Pick<
    ProjectOverview,
    'cpu_percent' | 'memory_bytes' | 'last_activity' | 'is_stale' | 'runtime'
  > | null;
  /** Live (or fixture) resource sample. Drives the CPU/RAM badge. */
  sample?: ResourceSample;
  /** Recent CPU samples for the sparkline. Newest-last. */
  cpuHistory?: number[];
  git?: GitStatus | null;
  onStart?: () => void;
  onStop?: () => void;
  onOpenLogs?: () => void;
  onOpenInIde?: () => void;
  className?: string;
}

const statusLabel: Record<Status, string> = {
  running: 'Running',
  starting: 'Starting',
  stopping: 'Stopping',
  stopped: 'Stopped',
  exited: 'Exited',
  crashed: 'Crashed',
};

/**
 * Marketing-grade service card. Same visual language as the desktop
 * dashboard's `ServiceCard`, minus the live store reads, IPC actions,
 * confirm dialogs, drawer wiring, and `memo`-driven render gating —
 * none of that adds value on a static demo. Supplies pure callbacks
 * (`onStart` / `onStop` / `onOpenLogs` / `onOpenInIde`) so the
 * marketing site can wire them to "open the install section" or any
 * other promo intent.
 */
export function ServiceCard({
  service,
  status,
  overview,
  sample,
  cpuHistory,
  git,
  onStart,
  onStop,
  onOpenLogs,
  onOpenInIde,
  className,
}: Props) {
  const isRunning = status === 'running' || status === 'starting';
  return (
    <div
      className={cn(
        'border-border bg-surface-overlay group relative flex flex-col gap-3 rounded-xl border p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <StatusDot status={status} size="md" className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-fg truncate text-[14px] font-semibold">{service.name}</h3>
            {overview?.runtime && (
              <span className="bg-surface-muted text-fg-muted rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase">
                {overview.runtime}
              </span>
            )}
          </div>
          <div className="text-fg-dim mt-0.5 truncate font-mono text-[11px]">{service.cwd}</div>
        </div>
        <div className="flex items-center gap-1">
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="hover:bg-status-error/10 hover:text-status-error text-fg-muted flex h-7 w-7 items-center justify-center rounded transition"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              title="Start"
              className="hover:bg-status-running/10 hover:text-status-running text-fg-muted flex h-7 w-7 items-center justify-center rounded transition"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenLogs}
            title="Open logs"
            className="hover:bg-accent/10 hover:text-accent text-fg-muted flex h-7 w-7 items-center justify-center rounded transition"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenInIde}
            title="Open in editor"
            className="hover:bg-accent/10 hover:text-accent text-fg-muted flex h-7 w-7 items-center justify-center rounded transition"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-fg-muted text-[11.5px]">{statusLabel[status]}</span>
        {typeof service.port === 'number' && (
          <span className="text-fg-dim font-mono text-[11.5px]">:{service.port}</span>
        )}
        {git !== undefined && git !== null && (
          <GitStatusTrigger
            git={git}
            open={false}
            compact
            onToggle={() => {}}
            onOpenDiff={() => {}}
          />
        )}
        <div className="ml-auto flex items-center gap-3">
          <ResourceBadge sample={sample} compact />
          <Sparkline data={cpuHistory} width={64} height={20} />
        </div>
      </div>
    </div>
  );
}
