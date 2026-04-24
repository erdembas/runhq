import { FileDiff } from 'lucide-react';
import { SidebarFilterMenu } from '../SidebarFilterMenu';
import { useAppStore } from '@/store/useAppStore';

export function WorkspaceHeader({
  servicesCount,
  runningCount,
  stacksCount,
}: {
  servicesCount: number;
  runningCount: number;
  stacksCount: number;
}) {
  // Cross-project dirty count is computed here (rather than passed down)
  // because `WorkspaceHeader` is the natural surface for workspace-scope
  // summary chips, and wiring yet another prop through SidebarRail would
  // bloat the API without adding value. The overview poller in App.tsx
  // refreshes this every 30s, so the number stays reasonably fresh.
  const overview = useAppStore((s) => s.overview);
  const openCrossProjectDiff = useAppStore((s) => s.openCrossProjectDiff);
  const dirtyProjectCount = overview?.projects.filter((p) => p.git_status?.is_dirty).length ?? 0;
  const dirtyFileCount =
    overview?.projects.reduce(
      (acc, p) => acc + (p.git_status?.is_dirty ? p.git_status.dirty_count : 0),
      0,
    ) ?? 0;

  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
      <span className="text-fg-dim text-[10.5px] font-semibold tracking-[0.18em] uppercase">
        Workspace
      </span>
      <span className="bg-surface-muted text-fg-muted rounded-app-sm px-1.5 text-[10px] tabular-nums">
        {servicesCount + stacksCount}
      </span>
      {runningCount > 0 && (
        <span className="bg-status-running/15 text-status-running rounded-app-sm px-1.5 text-[10px] tabular-nums">
          {runningCount} on
        </span>
      )}
      {dirtyProjectCount > 0 && (
        <button
          type="button"
          onClick={openCrossProjectDiff}
          title={`${dirtyFileCount} uncommitted file${dirtyFileCount === 1 ? '' : 's'} across ${dirtyProjectCount} project${dirtyProjectCount === 1 ? '' : 's'} — click to review`}
          className="bg-status-starting/15 text-status-starting hover:bg-status-starting/25 rounded-app-sm inline-flex items-center gap-1 px-1.5 text-[10px] font-medium tabular-nums transition"
          aria-label={`Review ${dirtyFileCount} uncommitted changes across projects`}
        >
          <FileDiff size={9} strokeWidth={2.2} />
          {dirtyProjectCount} dirty
        </button>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <SidebarFilterMenu />
      </div>
    </div>
  );
}
