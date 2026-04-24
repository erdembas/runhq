import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, Search, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { type FileEntry, buildTree, collectFolderPaths, statusLetterStyle } from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { TreeView } from '@/components/git/shared';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { BranchPicker, type BranchPickerOption } from '@/components/ui/BranchPicker';
import type { DiffSummary, ServiceId } from '@/types';

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
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string>('');
  const [headBranch, setHeadBranch] = useState<string>('');
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileSearch, setFileSearch] = useState('');

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
          setBranches(list);
          setHeadBranch((current) => current || list[0] || '');
        }
      } catch (err) {
        console.error('Failed to load branches', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, refreshTick]);

  const loadDiff = useCallback(async () => {
    if (!baseBranch || !headBranch || baseBranch === headBranch) return;
    setLoading(true);
    try {
      const result = await ipc.gitDiffBranches(serviceId, baseBranch, headBranch);
      setDiff(result);
      setSelectedFile(result.files[0]?.path ?? null);
    } catch (err) {
      console.error('Failed to load branch diff', err);
    } finally {
      setLoading(false);
    }
  }, [serviceId, baseBranch, headBranch]);

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
    if (!selectedFile) return;
    let cancelled = false;
    setFileLoading(true);
    (async () => {
      try {
        const raw = await ipc.gitDiffFile(serviceId, selectedFile, fullFileContext);
        if (!cancelled) setFileDiff(raw);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load branch file diff', err);
          setFileDiff(null);
        }
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selectedFile, fullFileContext]);

  const entries: FileEntry[] = useMemo(() => {
    const sec = `${baseBranch || '?'} … ${headBranch || '?'}`;
    return diff?.files.map((f) => ({ ...f, section: sec })) ?? [];
  }, [diff, baseBranch, headBranch]);

  const fileSearchTrim = fileSearch.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!fileSearchTrim) return entries;
    return entries.filter((f) => f.path.toLowerCase().includes(fileSearchTrim));
  }, [entries, fileSearchTrim]);

  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  useEffect(() => {
    const set = new Set<string>();
    collectFolderPaths(tree, set);
    setExpandedFolders(set);
  }, [tree]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectedMeta: FileEntry | null = useMemo(
    () => entries.find((f) => f.path === selectedFile) ?? null,
    [entries, selectedFile],
  );

  const totalAdditions = entries.reduce((a, f) => a + f.additions, 0);
  const totalDeletions = entries.reduce((a, f) => a + f.deletions, 0);

  // Branches are reused for both Base and Head pickers — same set,
  // separate selections. The local branches stay grouped under
  // "Branches" so the picker UI matches every other branch dropdown
  // in the app.
  const branchOptions: BranchPickerOption[] = useMemo(
    () => branches.map((b) => ({ value: b, label: b, group: 'Branches' })),
    [branches],
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
              value={baseBranch}
              onChange={setBaseBranch}
              options={branchOptions}
              placeholder="Base…"
              className="min-w-0 flex-1"
            />
            <span className="text-fg/40">…</span>
            <BranchPicker
              value={headBranch}
              onChange={setHeadBranch}
              options={branchOptions}
              placeholder="Head…"
              className="min-w-0 flex-1"
            />
          </div>
          <button
            onClick={() => void loadDiff()}
            disabled={!baseBranch || !headBranch || baseBranch === headBranch || loading}
            className="border-border bg-accent/10 text-accent hover:bg-accent/20 flex w-full items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
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
          <div
            className="ml-2 flex items-center gap-1"
            title="Added · Modified · Deleted · Renamed"
          >
            {(
              [
                ['added', 'A'],
                ['modified', 'M'],
                ['deleted', 'D'],
                ['renamed', 'R'],
              ] as const
            ).map(([status, letter]) => (
              <span
                key={status}
                className="inline-flex items-center justify-center font-bold tabular-nums"
                style={{
                  ...statusLetterStyle[status],
                  height: 13,
                  minWidth: 13,
                  borderRadius: 3,
                  paddingLeft: 2,
                  paddingRight: 2,
                  fontSize: 8,
                  lineHeight: 1,
                }}
              >
                {letter}
              </span>
            ))}
          </div>
        </div>

        {/* File search */}
        <div className="border-border border-b px-2 py-1.5">
          <div className="border-border bg-surface focus-within:border-accent/50 flex h-7 items-center gap-1.5 rounded border px-2 transition-colors">
            <Search size={11} className="text-fg/40 shrink-0" />
            <input
              type="text"
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              placeholder="Search files…"
              spellCheck={false}
              className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            />
            {fileSearch && (
              <button
                onClick={() => setFileSearch('')}
                className="text-fg/40 hover:text-fg shrink-0 cursor-pointer transition"
                title="Clear"
                type="button"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!diff && !loading && (
            <p className="text-fg/40 px-3 py-2 text-xs">Select two branches and press Compare.</p>
          )}
          {loading && <p className="text-fg/40 px-3 py-2 text-xs">Loading diff…</p>}
          {diff && !loading && entries.length === 0 && (
            <p className="text-fg/40 px-3 py-2 text-xs">
              {baseBranch} and {headBranch} are identical.
            </p>
          )}
          {diff && !loading && entries.length > 0 && filteredEntries.length === 0 && (
            <p className="text-fg/40 px-3 py-2 text-xs">
              No files match &ldquo;{fileSearch}&rdquo;
            </p>
          )}
          {filteredEntries.length > 0 && (
            <TreeView
              node={tree}
              level={0}
              expanded={expandedFolders}
              onToggle={toggleFolder}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
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
          selectedFile={selectedFile}
          fileDiff={fileDiff}
          selectedMeta={selectedMeta}
          monacoTheme={monacoTheme}
          cwd={cwd}
          viewMode={viewMode}
          fileLoading={fileLoading}
          emptyLabel={
            !diff ? 'Select two branches above and press Compare' : 'Select a file to view its diff'
          }
        />
      </div>
    </div>
  );
}
