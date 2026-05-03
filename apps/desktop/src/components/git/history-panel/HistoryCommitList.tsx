import { ChevronLeft, GitBranch, RefreshCw, Tag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { authorHue, initialsFor, timeAgo } from '@/lib/gitDiff';
import { FileSearchInput } from '@/components/git/shared';
import { BranchPicker, type BranchPickerOption } from '@/components/ui/BranchPicker';
import type { CommitSummary } from '@/types';
import type { HistoryPanelStore } from '@/components/git/useHistoryPanelStore';

interface HistoryCommitListProps {
  panel: HistoryPanelStore;
  patch: HistoryPanelStore['patch'];
  branchOptions: BranchPickerOption[];
  filteredCommits: CommitSummary[];
  commitSearchTrim: string;
  width: number;
  onCollapse: () => void;
}

export function HistoryCommitList({
  panel,
  patch,
  branchOptions,
  filteredCommits,
  commitSearchTrim,
  width,
  onCollapse,
}: HistoryCommitListProps) {
  return (
    <div className="border-border flex shrink-0 flex-col border-r" style={{ width }}>
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <BranchPicker
          value={panel.branchFilter}
          onChange={(branchFilter) => patch({ branchFilter })}
          options={branchOptions}
          className="min-w-0 flex-1"
        />
        <span className="text-fg/40 shrink-0 text-[10px] tabular-nums">
          {commitSearchTrim
            ? `${filteredCommits.length}/${panel.commits.length}`
            : panel.commits.length}
        </span>
        <button
          type="button"
          onClick={onCollapse}
          title="Hide commit list"
          aria-label="Hide commit list"
          className="text-fg/40 hover:bg-fg/10 hover:text-fg flex h-5 w-5 shrink-0 items-center justify-center rounded transition"
        >
          <ChevronLeft size={12} />
        </button>
      </div>

      <FileSearchInput
        value={panel.commitSearch}
        onChange={(commitSearch) => patch({ commitSearch })}
        placeholder="Search commits…"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel.loading && (
          <p className="text-fg/40 flex items-center gap-2 px-3 py-3 text-xs">
            <RefreshCw size={11} className="animate-spin" />
            Loading commits…
          </p>
        )}
        {!panel.loading && panel.commits.length === 0 && (
          <p className="text-fg/40 px-3 py-3 text-xs">No commits yet</p>
        )}
        {!panel.loading && panel.commits.length > 0 && filteredCommits.length === 0 && (
          <p className="text-fg/40 px-3 py-3 text-xs">
            No commits match &ldquo;{panel.commitSearch}&rdquo;
          </p>
        )}
        {filteredCommits.map((commit) => {
          const isActive = panel.selectedCommit?.hash_full === commit.hash_full;
          const hue = authorHue(commit.author);
          const isMerge = commit.parents.length > 1;

          return (
            <button
              key={commit.hash_full}
              onClick={() => patch({ selectedCommit: commit })}
              className={cn(
                'group relative flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors',
                isActive ? 'bg-accent/15 border-accent' : 'hover:bg-fg/6 border-transparent',
              )}
            >
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
                title={commit.author}
              >
                {initialsFor(commit.author)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-fg flex items-center gap-1.5 text-[12px]">
                  {isMerge && (
                    <GitBranch size={10} className="shrink-0 text-sky-400/80" strokeWidth={2} />
                  )}
                  <span className="truncate font-medium">{commit.subject}</span>
                </div>
                <div className="text-fg/50 mt-0.5 flex items-center gap-1.5 text-[10px]">
                  <code className="bg-fg/10 rounded px-1 py-px font-mono text-[9px]">
                    {commit.hash_short}
                  </code>
                  <span className="truncate">{commit.author}</span>
                  <span className="text-fg/30">·</span>
                  <span className="shrink-0">{timeAgo(commit.timestamp)}</span>
                </div>
                {commit.refs.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {commit.refs.map((ref) => {
                      const clean = ref.replace(/^HEAD -> /, '');
                      const isHead = ref.startsWith('HEAD ');
                      const isTag = clean.startsWith('tag: ');

                      return (
                        <span
                          key={ref}
                          className={cn(
                            'inline-flex items-center gap-0.5 rounded border px-1 py-px text-[9px]',
                            isHead
                              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                              : isTag
                                ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                                : 'border-sky-400/30 bg-sky-400/10 text-sky-300',
                          )}
                        >
                          {isTag ? <Tag size={8} /> : <GitBranch size={8} />}
                          {clean.replace(/^tag: /, '')}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
