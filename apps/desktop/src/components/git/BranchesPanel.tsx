import { useCallback, useEffect, useMemo } from 'react';
import { GitBranch, RefreshCw } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { type FileEntry, buildTree } from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { FileSearchInput, GitStatusLegend, TreeView } from '@/components/git/shared';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { BranchPicker, type BranchPickerOption } from '@/components/ui/BranchPicker';
import { useBranchesPanelStore, useBranchesPanelStoreRef } from './useBranchesPanelStore';
import type { ServiceId } from '@/types';

interface BranchesPanelProps {
  serviceId: ServiceId;
  cwd: string | null;
  monacoTheme: string;
  viewMode: DiffViewMode;
  refreshTick: number;
}

/**
 * Two-branch diff comparator — used to be a sub-mode of the old Changes
 * tab. Promoted to a top-level tab when Changes was folded into Commit:
 * branch-vs-branch comparison is conceptually unrelated to the commit
 * workflow, so cramming it into the Commit panel would have been a
 * VSCode anti-pattern.
 */
export function BranchesPanel({
  serviceId,
  cwd,
  monacoTheme,
  viewMode,
  refreshTick,
}: BranchesPanelProps) {
  const store = useBranchesPanelStoreRef();
  const branch = useBranchesPanelStore(store, (state) => state);
  const patch = branch.patch;
  const expandTree = branch.expandTree;

  const sidebar = useResizableWidth({
    storageKey: 'runhq.diff.branches.sidebar.v1',
    defaultWidth: 320,
    min: 320,
    max: 600,
  });

  // Refresh branch list whenever the parent ticks. Branch creation /
  // deletion happens from other panels (CommitPanel, history actions),
  // and we want the dropdowns to reflect that without a panel reopen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await ipc.gitBranches(serviceId);
        if (!cancelled) {
          patch((state) => ({
            branches: list,
            headBranch: state.headBranch || list[0] || '',
          }));
        }
      } catch (err) {
        console.error('Failed to load branches', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patch, serviceId, refreshTick]);

  const loadDiff = useCallback(async () => {
    if (!branch.baseBranch || !branch.headBranch || branch.baseBranch === branch.headBranch) return;
    patch({ loading: true });
    try {
      const result = await ipc.gitDiffBranches(serviceId, branch.baseBranch, branch.headBranch);
      patch({ diff: result, selectedFile: result.files[0]?.path ?? null });
    } catch (err) {
      console.error('Failed to load branch diff', err);
    } finally {
      patch({ loading: false });
    }
  }, [serviceId, branch.baseBranch, branch.headBranch, patch]);

  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Branch diffs use `git diff base...head` which is a *committed* diff,
  // not a working-tree diff. Reuse `gitDiffCommitFile` against HEAD…
  // wait, no: there's a dedicated `gitDiffBranches` for the file list,
  // but per-file content needs to come from `git diff base...head -- file`.
  // We approximate using `gitDiffFile` against HEAD which is wrong for
  // arbitrary base/head pairs. For now keep behaviour identical to the
  // old Changes tab: use `gitDiffFile` (working tree). Replacing this
  // with a branch-aware command is tracked separately — the old code
  // had the same limitation.
  useEffect(() => {
    if (!branch.selectedFile) return;
    let cancelled = false;
    patch({ fileLoading: true });
    (async () => {
      try {
        const raw = await ipc.gitDiffFile(serviceId, branch.selectedFile!, fullFileContext);
        if (!cancelled) patch({ fileDiff: raw });
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load branch file diff', err);
          patch({ fileDiff: null });
        }
      } finally {
        if (!cancelled) patch({ fileLoading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, branch.selectedFile, fullFileContext, patch]);

  const entries: FileEntry[] = useMemo(() => {
    const sec = `${branch.baseBranch || '?'} … ${branch.headBranch || '?'}`;
    return branch.diff?.files.map((f) => ({ ...f, section: sec })) ?? [];
  }, [branch.diff, branch.baseBranch, branch.headBranch]);

  const fileSearchTrim = branch.fileSearch.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!fileSearchTrim) return entries;
    return entries.filter((f) => f.path.toLowerCase().includes(fileSearchTrim));
  }, [entries, fileSearchTrim]);

  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  useEffect(() => {
    expandTree(tree);
  }, [expandTree, tree]);

  const selectedMeta: FileEntry | null = useMemo(
    () => entries.find((f) => f.path === branch.selectedFile) ?? null,
    [entries, branch.selectedFile],
  );

  const totalAdditions = entries.reduce((a, f) => a + f.additions, 0);
  const totalDeletions = entries.reduce((a, f) => a + f.deletions, 0);

  // Branches are reused for both Base and Head pickers — same set,
  // separate selections. The local branches stay grouped under
  // "Branches" so the picker UI matches every other branch dropdown
  // in the app.
  const branchOptions: BranchPickerOption[] = useMemo(
    () => branch.branches.map((b) => ({ value: b, label: b, group: 'Branches' })),
    [branch.branches],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className="border-border flex shrink-0 flex-col border-r"
        style={{ width: sidebar.width }}
      >
        {/* Branch picker */}
        <div className="border-border space-y-1.5 border-b px-2 py-2">
          <div className="text-fg/50 flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
            <GitBranch size={11} />
            <span>Compare branches</span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <BranchPicker
              value={branch.baseBranch}
              onChange={(baseBranch) => patch({ baseBranch })}
              options={branchOptions}
              placeholder="Base…"
              className="min-w-0 flex-1"
            />
            <span className="text-fg/40">…</span>
            <BranchPicker
              value={branch.headBranch}
              onChange={(headBranch) => patch({ headBranch })}
              options={branchOptions}
              placeholder="Head…"
              className="min-w-0 flex-1"
            />
          </div>
          <button
            onClick={() => void loadDiff()}
            disabled={
              !branch.baseBranch ||
              !branch.headBranch ||
              branch.baseBranch === branch.headBranch ||
              branch.loading
            }
            className="border-border bg-accent/10 text-accent hover:bg-accent/20 flex w-full items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={11} className={branch.loading ? 'animate-spin' : ''} />
            Compare
          </button>
        </div>

        {/* Status legend */}
        <div className="border-border flex items-center gap-1 border-b px-2 py-1">
          <span className="text-fg/50 text-[10px]">
            {entries.length} file{entries.length === 1 ? '' : 's'}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[9px] tabular-nums">
            <span className="text-emerald-400/80">+{totalAdditions}</span>
            <span className="text-rose-400/80">−{totalDeletions}</span>
          </span>
          <div className="ml-2">
            <GitStatusLegend />
          </div>
        </div>

        {/* File search */}
        <FileSearchInput
          value={branch.fileSearch}
          onChange={(fileSearch) => patch({ fileSearch })}
        />

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!branch.diff && !branch.loading && (
            <p className="text-fg/40 px-3 py-2 text-xs">Select two branches and press Compare.</p>
          )}
          {branch.loading && <p className="text-fg/40 px-3 py-2 text-xs">Loading diff…</p>}
          {branch.diff && !branch.loading && entries.length === 0 && (
            <p className="text-fg/40 px-3 py-2 text-xs">
              {branch.baseBranch} and {branch.headBranch} are identical.
            </p>
          )}
          {branch.diff && !branch.loading && entries.length > 0 && filteredEntries.length === 0 && (
            <p className="text-fg/40 px-3 py-2 text-xs">
              No files match &ldquo;{branch.fileSearch}&rdquo;
            </p>
          )}
          {filteredEntries.length > 0 && (
            <TreeView
              node={tree}
              level={0}
              expanded={branch.expandedFolders}
              onToggle={branch.toggleFolder}
              selectedFile={branch.selectedFile}
              onSelect={(selectedFile) => patch({ selectedFile })}
            />
          )}
        </div>
      </div>

      <ResizeHandle
        handleProps={sidebar.handleProps}
        dragging={sidebar.dragging}
        title="Drag to resize file explorer · double-click to reset"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <DiffPane
          selectedFile={branch.selectedFile}
          fileDiff={branch.fileDiff}
          selectedMeta={selectedMeta}
          monacoTheme={monacoTheme}
          cwd={cwd}
          viewMode={viewMode}
          fileLoading={branch.fileLoading}
          emptyLabel={
            !branch.diff
              ? 'Select two branches above and press Compare'
              : 'Select a file to view its diff'
          }
        />
      </div>
    </div>
  );
}
