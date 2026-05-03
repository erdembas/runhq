import { Activity, PanelRightOpen } from 'lucide-react';
import type { DailySummary } from '@/types';

interface ActivityCollapsedRailProps {
  onClick: () => void;
  onFocus: () => void;
  summary: DailySummary | null;
}

export function ActivityCollapsedRail({ onClick, onFocus, summary }: ActivityCollapsedRailProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      className="bg-surface border-border/40 hover:bg-fg/3 group flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l pt-3.5 transition"
      title="Click to pin · hover to peek"
      aria-label="Expand activity timeline"
    >
      <div className="bg-accent/10 text-accent group-hover:bg-accent/20 flex h-7 w-7 items-center justify-center rounded-md transition">
        <Activity className="h-3.5 w-3.5" />
      </div>
      {summary && (
        <div className="flex flex-col items-center gap-1.5">
          {summary.commits > 0 && (
            <span
              className="text-[10.5px] font-semibold text-violet-400 tabular-nums"
              title={`${summary.commits} commit${summary.commits === 1 ? '' : 's'} today`}
            >
              {summary.commits}
            </span>
          )}
          {summary.services_started > 0 && (
            <span
              className="text-[10.5px] font-semibold text-emerald-400 tabular-nums"
              title={`${summary.services_started} start${
                summary.services_started === 1 ? '' : 's'
              } today`}
            >
              {summary.services_started}
            </span>
          )}
          {summary.errors > 0 && (
            <span
              className="relative text-[10.5px] font-semibold text-rose-400 tabular-nums"
              title={`${summary.errors} error${summary.errors === 1 ? '' : 's'} today`}
            >
              {summary.errors}
              <span className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
            </span>
          )}
        </div>
      )}
      <PanelRightOpen className="text-fg/25 group-hover:text-fg/55 mt-auto mb-3 h-3.5 w-3.5 transition" />
    </button>
  );
}
