import type { ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronLeft, GitCommit, RefreshCw, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TreeView } from '@/components/git/shared';
import type { HistoryPanelStore } from '@/components/git/useHistoryPanelStore';
import type { FileEntry, TreeNode } from '@/lib/gitDiff';

interface HistoryChangedFilesPanelProps {
  panel: HistoryPanelStore;
  patch: HistoryPanelStore['patch'];
  files: FileEntry[];
  tree: TreeNode;
  width: number;
  explainTriggerRef: RefObject<HTMLButtonElement>;
  explainPopover: ReactNode;
  onExplainCommit: () => void;
  onCollapse: () => void;
}

export function HistoryChangedFilesPanel({
  panel,
  patch,
  files,
  tree,
  width,
  explainTriggerRef,
  explainPopover,
  onExplainCommit,
  onCollapse,
}: HistoryChangedFilesPanelProps) {
  return (
    <div className="border-border flex shrink-0 flex-col border-r" style={{ width }}>
      {panel.selectedCommit ? (
        <>
          <div className="border-border border-b px-3 py-2.5">
            <div className="text-fg/60 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase">
              <GitCommit size={11} />
              <span>Commit</span>
              <button
                ref={explainTriggerRef}
                type="button"
                onClick={() => {
                  if (!panel.commitDiff || panel.commitDiff.files.length === 0) return;
                  onExplainCommit();
                }}
                disabled={
                  panel.commitDiffLoading ||
                  !panel.commitDiff ||
                  panel.commitDiff.files.length === 0
                }
                title={
                  panel.commitDiffLoading
                    ? 'Loading commit diff…'
                    : !panel.commitDiff || panel.commitDiff.files.length === 0
                      ? 'Nothing to explain — empty commit'
                      : `Explain this whole commit (${panel.commitDiff.files.length} file${
                          panel.commitDiff.files.length === 1 ? '' : 's'
                        }) with AI`
                }
                aria-label="Explain this commit with AI"
                className={cn(
                  'ml-auto flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium tracking-normal normal-case transition',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  'text-fg/50 hover:bg-fg/10 hover:text-fg',
                )}
              >
                <Sparkles size={11} />
                <span className="hidden sm:inline">Explain commit</span>
              </button>
              {explainPopover}
              <button
                type="button"
                onClick={onCollapse}
                title="Hide changed files"
                aria-label="Hide changed files"
                className="text-fg/40 hover:bg-fg/10 hover:text-fg flex h-5 w-5 shrink-0 items-center justify-center rounded transition"
              >
                <ChevronLeft size={12} />
              </button>
            </div>
            <div className="text-fg mt-1 text-[13px] leading-snug font-semibold">
              {panel.selectedCommit.subject}
            </div>
            <div className="text-fg/50 mt-2 flex flex-col gap-1 text-[10.5px]">
              <div className="flex items-center gap-1.5">
                <User size={10} />
                <span className="truncate">
                  {panel.selectedCommit.author}{' '}
                  <span className="text-fg/30">&lt;{panel.selectedCommit.email}&gt;</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <code className="bg-fg/10 rounded px-1 py-px font-mono text-[9px]">
                  {panel.selectedCommit.hash_short}
                </code>
                <span className="text-fg/40">·</span>
                <span>{new Date(panel.selectedCommit.timestamp * 1000).toLocaleString()}</span>
              </div>
              {panel.selectedCommit.parents.length > 0 && (
                <div className="text-fg/40 flex flex-wrap items-center gap-1">
                  <span>Parents:</span>
                  {panel.selectedCommit.parents.map((parent) => (
                    <code
                      key={parent}
                      className="bg-fg/10 text-fg/70 rounded px-1 py-px font-mono text-[9px]"
                    >
                      {parent.slice(0, 7)}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-fg/50 flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold tracking-wider uppercase">
            <ChevronDown size={11} className="text-fg/40" />
            <span>Changed files</span>
            <span className="bg-fg/10 text-fg/60 rounded px-1 py-px text-[9px] tabular-nums">
              {panel.commitDiff?.files.length ?? 0}
            </span>
            <span className="ml-auto flex items-center gap-1 text-[9px] normal-case tabular-nums">
              <span className="text-emerald-400/80">+{panel.commitDiff?.total_additions ?? 0}</span>
              <span className="text-rose-400/80">−{panel.commitDiff?.total_deletions ?? 0}</span>
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {panel.commitDiffLoading && (
              <p className="text-fg/40 flex items-center gap-2 px-3 py-3 text-xs">
                <RefreshCw size={11} className="animate-spin" />
                Loading files…
              </p>
            )}
            {!panel.commitDiffLoading &&
              panel.commitDiff &&
              panel.commitDiff.files.length === 0 && (
                <p className="text-fg/40 px-3 py-3 text-xs">Empty commit — no file changes</p>
              )}
            {!panel.commitDiffLoading && files.length > 0 && (
              <TreeView
                node={tree}
                level={0}
                expanded={panel.expandedFolders}
                onToggle={panel.toggleFolder}
                selectedFile={panel.selectedFile}
                onSelect={(selectedFile) => patch({ selectedFile })}
              />
            )}
          </div>
        </>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onCollapse}
            title="Hide changed files"
            aria-label="Hide changed files"
            className="text-fg/40 hover:bg-fg/10 hover:text-fg absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded transition"
          >
            <ChevronLeft size={12} />
          </button>
          <div className="text-fg/40 flex flex-1 items-center justify-center px-4 text-center text-xs">
            {panel.loading ? 'Loading…' : 'Select a commit to see its changes'}
          </div>
        </div>
      )}
    </div>
  );
}
