import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitCommit,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { StagingBlock } from './StagingBlock';
import type { Selection, ServiceTree } from './types';

interface ServiceSectionProps {
  tree: ServiceTree;
  collapsed: boolean;
  expandedFolders: Set<string>;
  onToggleService: () => void;
  onToggleFolder: (path: string) => void;
  selection: Selection | null;
  onSelect: (source: 'unstaged' | 'staged', path: string) => void;
  onOpenInDiffViewer: () => void;
}

export function ServiceSection({
  tree,
  collapsed,
  expandedFolders,
  onToggleService,
  onToggleFolder,
  selection,
  onSelect,
  onOpenInDiffViewer,
}: ServiceSectionProps) {
  const {
    project,
    unstagedTree,
    stagedTree,
    totalFiles,
    totalAdditions,
    totalDeletions,
    loading,
    error,
  } = tree;
  const git = project.git_status;
  const branch = git?.branch ?? 'detached';
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  const stagedFiles = tree.stagedEntries.length;
  const unstagedFiles = tree.unstagedEntries.length;

  return (
    <section className="border-border/40 mb-1 border-b last:border-b-0">
      <div
        className={cn(
          'group relative flex w-full items-center gap-2 py-1.5 pr-1 pl-2 text-left transition',
          'hover:bg-fg/6',
        )}
      >
        <button
          type="button"
          onClick={onToggleService}
          className="text-fg flex min-w-0 flex-1 items-center gap-1.5"
        >
          {collapsed ? (
            <ChevronRight size={13} className="text-fg/50 shrink-0" />
          ) : (
            <ChevronDown size={13} className="text-fg/50 shrink-0" />
          )}
          <span className="text-fg truncate text-[12.5px] font-semibold">{project.name}</span>
          <span className="text-fg/40 shrink-0 text-[10px]">·</span>
          <span className="text-fg/50 inline-flex shrink-0 items-center gap-0.5 text-[10.5px]">
            <GitBranch size={10} />
            <span className="max-w-[120px] truncate">{branch}</span>
          </span>
          {ahead > 0 && (
            <span className="text-status-running inline-flex shrink-0 items-center text-[10px] tabular-nums">
              <ArrowUp size={10} />
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span className="text-status-starting inline-flex shrink-0 items-center text-[10px] tabular-nums">
              <ArrowDown size={10} />
              {behind}
            </span>
          )}
        </button>
        <span className="text-fg/50 flex shrink-0 items-center gap-1.5 pr-1 text-[10px] tabular-nums">
          {totalAdditions > 0 && <span className="text-emerald-400/80">+{totalAdditions}</span>}
          {totalDeletions > 0 && <span className="text-rose-400/80">−{totalDeletions}</span>}
          <span className="text-fg/40">{totalFiles}</span>
        </span>
        <button
          type="button"
          onClick={onOpenInDiffViewer}
          title="Open in full diff viewer (Commit / History / Graph)"
          className={cn(
            'text-fg/50 hover:text-fg hover:bg-surface-raised flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
            'opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
          aria-label={`Open ${project.name} in diff viewer`}
        >
          <ExternalLink size={11} />
        </button>
      </div>

      {!collapsed && (
        <div>
          {error && (
            <div className="text-status-error bg-status-error/10 mx-2 my-1 rounded px-2 py-1 text-[11px]">
              {error}
            </div>
          )}
          {loading && !error && (
            <div className="text-fg/40 flex items-center gap-1.5 px-3 py-2 text-[11px]">
              <RefreshCw size={10} className="animate-spin" />
              Loading…
            </div>
          )}
          {!loading && !error && totalFiles === 0 && (
            <div className="text-fg/30 px-3 py-1.5 text-[11px] italic">no matching files</div>
          )}

          {stagedFiles > 0 && (
            <StagingBlock
              label="Staged"
              hintIcon={<GitCommit size={10} />}
              count={stagedFiles}
              tree={stagedTree}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              selection={selection}
              serviceId={project.service_id}
              source="staged"
              onSelect={onSelect}
            />
          )}

          {unstagedFiles > 0 && (
            <StagingBlock
              label="Changes"
              hintIcon={<FileDiff size={10} />}
              count={unstagedFiles}
              tree={unstagedTree}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              selection={selection}
              serviceId={project.service_id}
              source="unstaged"
              onSelect={onSelect}
            />
          )}
        </div>
      )}
    </section>
  );
}
