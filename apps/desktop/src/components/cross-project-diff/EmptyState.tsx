import { FileDiff, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  search: string;
  anyLoading: boolean;
}

export function EmptyState({ search, anyLoading }: EmptyStateProps) {
  if (anyLoading) {
    return (
      <div className="text-fg/40 flex flex-col items-center gap-2 p-6 text-[12px]">
        <RefreshCw size={18} className="animate-spin" />
        <span>Loading diffs…</span>
      </div>
    );
  }

  if (search) {
    return (
      <div className="text-fg/40 p-6 text-center text-[12px]">
        No files match <span className="text-fg/70 font-mono">{search}</span>
      </div>
    );
  }

  return (
    <div className="text-fg/50 flex flex-col items-center gap-3 p-8 text-center text-[12px]">
      <div className="bg-status-running/10 text-status-running flex h-12 w-12 items-center justify-center rounded-full">
        <FileDiff size={24} />
      </div>
      <p className="text-fg/80 font-medium">All projects clean</p>
      <p className="text-fg/40 max-w-[240px] text-[11px]">
        No uncommitted changes anywhere. Switch branches with confidence.
      </p>
    </div>
  );
}
