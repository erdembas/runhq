import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitBranch, GitCommit, RefreshCw, Search, Tag, User, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/cn';
import {
  type FileEntry,
  authorHue,
  buildTree,
  collectFolderPaths,
  initialsFor,
  timeAgo,
} from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { TreeView } from '@/components/git/shared';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { BranchPicker, type BranchPickerOption } from '@/components/ui/BranchPicker';
import type { CommitSummary, DiffSummary, ServiceId } from '@/types';

interface HistoryPanelProps {
  serviceId: ServiceId;
  cwd: string | null;
  monacoTheme: string;
  viewMode: DiffViewMode;
  refreshTick: number;
}

type BranchFilter = '__head__' | '__all__' | string;

export function HistoryPanel({
  serviceId,
  cwd,
  monacoTheme,
  viewMode,
  refreshTick,
}: HistoryPanelProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('__head__');
  const [loading, setLoading] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffSummary | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);

  const commitsSidebar = useResizableWidth({
    storageKey: 'runhq.diff.history.commits.v1',
    defaultWidth: 320,
    min: 320,
    max: 600,
  });
  const filesSidebar = useResizableWidth({
    storageKey: 'runhq.diff.history.files.v1',
    defaultWidth: 320,
    min: 320,
    max: 600,
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [commitSearch, setCommitSearch] = useState('');

  // Load the commit list whenever the branch filter or refresh tick flips.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [list, brs] = await Promise.all([
          ipc.gitLog(
            serviceId,
            branchFilter === '__head__'
              ? null
              : branchFilter === '__all__'
                ? '--all'
                : branchFilter,
            200,
          ),
          ipc.gitBranches(serviceId),
        ]);
        if (cancelled) return;
        setCommits(list);
        setBranches(brs);
        // Auto-select the most recent commit so the diff pane isn't empty.
        if (list.length > 0) {
          setSelectedCommit((prev) => prev ?? list[0] ?? null);
        } else {
          setSelectedCommit(null);
        }
      } catch (err) {
        console.error('Failed to load history', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, branchFilter, refreshTick]);

  // Load diff summary for the selected commit.
  useEffect(() => {
    if (!selectedCommit) {
      setCommitDiff(null);
      setSelectedFile(null);
      return;
    }
    let cancelled = false;
    setCommitDiffLoading(true);
    (async () => {
      try {
        const diff = await ipc.gitShowCommit(serviceId, selectedCommit.hash_full);
        if (cancelled) return;
        setCommitDiff(diff);
        setSelectedFile(diff.files[0]?.path ?? null);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to show commit', err);
          setCommitDiff(null);
        }
      } finally {
        if (!cancelled) setCommitDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selectedCommit]);

  // "Full file" toggle observed here so commit diffs also get the big
  // `-U` context when it's on.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Load raw diff for the selected file inside the selected commit.
  useEffect(() => {
    if (!selectedCommit || !selectedFile) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    (async () => {
      try {
        const raw = await ipc.gitDiffCommitFile(
          serviceId,
          selectedCommit.hash_full,
          selectedFile,
          fullFileContext,
        );
        if (!cancelled) setFileDiff(raw);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load commit file diff', err);
          setFileDiff(null);
        }
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selectedCommit, selectedFile, fullFileContext]);

  const files: FileEntry[] = useMemo(
    () =>
      commitDiff?.files.map((f) => ({
        ...f,
        section: selectedCommit?.hash_short ?? '',
      })) ?? [],
    [commitDiff, selectedCommit],
  );
  const tree = useMemo(() => buildTree(files), [files]);

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
    () => files.find((f) => f.path === selectedFile) ?? null,
    [files, selectedFile],
  );

  // Client-side commit search — matches subject, author, email, and
  // both short/full hashes. Fast enough for the 200-commit cap we
  // currently load without server-side filtering.
  const commitSearchTrim = commitSearch.trim().toLowerCase();
  const filteredCommits = useMemo(() => {
    if (!commitSearchTrim) return commits;
    return commits.filter((c) => {
      const haystack = [c.subject, c.author, c.email, c.hash_short, c.hash_full, ...c.refs]
        .join(' ')
        .toLowerCase();
      return haystack.includes(commitSearchTrim);
    });
  }, [commits, commitSearchTrim]);

  const branchOptions: BranchPickerOption[] = useMemo(() => {
    const out: BranchPickerOption[] = [
      { value: '__head__', label: 'Current HEAD' },
      { value: '__all__', label: 'All branches' },
    ];
    for (const b of branches) {
      out.push({ value: b, label: b, group: 'Branches' });
    }
    return out;
  }, [branches]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Commit list — resizable 240–720px. */}
      <div
        className="border-border flex shrink-0 flex-col border-r"
        style={{ width: commitsSidebar.width }}
      >
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <BranchPicker
            value={branchFilter}
            onChange={setBranchFilter}
            options={branchOptions}
            className="min-w-0 flex-1"
          />
          <span className="text-fg/40 shrink-0 text-[10px] tabular-nums">
            {commitSearchTrim ? `${filteredCommits.length}/${commits.length}` : commits.length}
          </span>
        </div>

        {/* Commit search — client-side, matches subject/author/hash/refs */}
        <div className="border-border border-b px-2 py-1.5">
          <div className="border-border bg-surface focus-within:border-accent/50 flex h-7 items-center gap-1.5 rounded border px-2 transition-colors">
            <Search size={11} className="text-fg/40 shrink-0" />
            <input
              type="text"
              value={commitSearch}
              onChange={(e) => setCommitSearch(e.target.value)}
              placeholder="Search commits…"
              spellCheck={false}
              className="text-fg placeholder:text-fg/30 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            />
            {commitSearch && (
              <button
                onClick={() => setCommitSearch('')}
                className="text-fg/40 hover:text-fg shrink-0 cursor-pointer transition"
                title="Clear"
                type="button"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="text-fg/40 flex items-center gap-2 px-3 py-3 text-xs">
              <RefreshCw size={11} className="animate-spin" />
              Loading commits…
            </p>
          )}
          {!loading && commits.length === 0 && (
            <p className="text-fg/40 px-3 py-3 text-xs">No commits yet</p>
          )}
          {!loading && commits.length > 0 && filteredCommits.length === 0 && (
            <p className="text-fg/40 px-3 py-3 text-xs">
              No commits match &ldquo;{commitSearch}&rdquo;
            </p>
          )}
          {filteredCommits.map((c) => {
            const isActive = selectedCommit?.hash_full === c.hash_full;
            const hue = authorHue(c.author);
            const isMerge = c.parents.length > 1;
            return (
              <button
                key={c.hash_full}
                onClick={() => setSelectedCommit(c)}
                className={cn(
                  'group relative flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors',
                  isActive ? 'bg-accent/15 border-accent' : 'hover:bg-fg/6 border-transparent',
                )}
              >
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
                  title={c.author}
                >
                  {initialsFor(c.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-fg flex items-center gap-1.5 text-[12px]">
                    {isMerge && (
                      <GitBranch size={10} className="shrink-0 text-sky-400/80" strokeWidth={2} />
                    )}
                    <span className="truncate font-medium">{c.subject}</span>
                  </div>
                  <div className="text-fg/50 mt-0.5 flex items-center gap-1.5 text-[10px]">
                    <code className="bg-fg/10 rounded px-1 py-px font-mono text-[9px]">
                      {c.hash_short}
                    </code>
                    <span className="truncate">{c.author}</span>
                    <span className="text-fg/30">·</span>
                    <span className="shrink-0">{timeAgo(c.timestamp)}</span>
                  </div>
                  {c.refs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.refs.map((ref) => {
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

      <ResizeHandle
        handleProps={commitsSidebar.handleProps}
        dragging={commitsSidebar.dragging}
        title="Drag to resize commit list · double-click to reset"
      />

      {/* Commit detail + file tree — resizable 220–720px. */}
      <div
        className="border-border flex shrink-0 flex-col border-r"
        style={{ width: filesSidebar.width }}
      >
        {selectedCommit ? (
          <>
            <div className="border-border border-b px-3 py-2.5">
              <div className="text-fg/60 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase">
                <GitCommit size={11} />
                Commit
              </div>
              <div className="text-fg mt-1 text-[13px] leading-snug font-semibold">
                {selectedCommit.subject}
              </div>
              <div className="text-fg/50 mt-2 flex flex-col gap-1 text-[10.5px]">
                <div className="flex items-center gap-1.5">
                  <User size={10} />
                  <span className="truncate">
                    {selectedCommit.author}{' '}
                    <span className="text-fg/30">&lt;{selectedCommit.email}&gt;</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="bg-fg/10 rounded px-1 py-px font-mono text-[9px]">
                    {selectedCommit.hash_short}
                  </code>
                  <span className="text-fg/40">·</span>
                  <span>{new Date(selectedCommit.timestamp * 1000).toLocaleString()}</span>
                </div>
                {selectedCommit.parents.length > 0 && (
                  <div className="text-fg/40 flex flex-wrap items-center gap-1">
                    <span>Parents:</span>
                    {selectedCommit.parents.map((p) => (
                      <code
                        key={p}
                        className="bg-fg/10 text-fg/70 rounded px-1 py-px font-mono text-[9px]"
                      >
                        {p.slice(0, 7)}
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
                {commitDiff?.files.length ?? 0}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[9px] normal-case tabular-nums">
                <span className="text-emerald-400/80">+{commitDiff?.total_additions ?? 0}</span>
                <span className="text-rose-400/80">−{commitDiff?.total_deletions ?? 0}</span>
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {commitDiffLoading && (
                <p className="text-fg/40 flex items-center gap-2 px-3 py-3 text-xs">
                  <RefreshCw size={11} className="animate-spin" />
                  Loading files…
                </p>
              )}
              {!commitDiffLoading && commitDiff && commitDiff.files.length === 0 && (
                <p className="text-fg/40 px-3 py-3 text-xs">Empty commit — no file changes</p>
              )}
              {!commitDiffLoading && files.length > 0 && (
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
          </>
        ) : (
          <div className="text-fg/40 flex flex-1 items-center justify-center px-4 text-center text-xs">
            {loading ? 'Loading…' : 'Select a commit to see its changes'}
          </div>
        )}
      </div>

      <ResizeHandle
        handleProps={filesSidebar.handleProps}
        dragging={filesSidebar.dragging}
        title="Drag to resize file explorer · double-click to reset"
      />

      {/* Diff for the selected file in the selected commit */}
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
            selectedCommit ? 'Select a file from this commit' : 'Select a commit on the left'
          }
        />
      </div>
    </div>
  );
}
