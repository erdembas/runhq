import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  FileDiff,
  FoldVertical,
  GitBranch,
  GitCommit,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rows2,
  Search,
  UnfoldVertical,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { useTheme } from '@/lib/theme';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { useAppStore } from '@/store/useAppStore';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { type FileEntry, buildTree, collectFolderPaths } from '@/lib/gitDiff';
import { TreeView } from '@/components/git/shared';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import type { DiffSummary, ProjectOverview } from '@/types';

/** macOS overlays native traffic-lights on top of the window, so we need to
 *  reserve ~76px on the left so nothing sits underneath them. Same treatment
 *  as DiffViewer — keeps behaviour consistent across fullscreen surfaces. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

interface Props {
  onClose: () => void;
}

/** Rolled up per-service state kept in this view's local cache. The backend
 *  is the source of truth; we just merge unstaged + staged into one file list
 *  to match the mental model of "everything I haven't committed yet". */
interface ServiceBucket {
  project: ProjectOverview;
  unstaged: DiffSummary | null;
  staged: DiffSummary | null;
  loading: boolean;
  error: string | null;
}

/** Identifies a selected diff across every service in the viewer. A plain
 *  `string` can't disambiguate the same relative path appearing in two
 *  different repos, which is a normal situation in monorepo-adjacent
 *  workflows (multiple projects each have a `README.md`). */
interface Selection {
  serviceId: string;
  source: 'unstaged' | 'staged';
  path: string;
}

/**
 * Fullscreen overlay that surfaces every uncommitted change across every
 * tracked project in one tree. Goal is to prevent the "I forgot to commit
 * that two-line fix in project X before switching branches" failure mode
 * the roadmap calls out.
 *
 * Data flow: we read `overview.projects` (already polled by App.tsx every
 * 30s) for the list of dirty services, then fetch each service's unstaged
 * + staged diffs in parallel on open. The diffs themselves are re-fetched
 * on Refresh; the per-file diff body is loaded lazily when selected.
 */
export function CrossProjectDiffViewer({ onClose }: Props) {
  const overview = useAppStore((s) => s.overview);
  const services = useAppStore((s) => s.services);
  const openDiffViewer = useAppStore((s) => s.openDiffViewer);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);

  const { effective: effectiveTheme } = useTheme();
  const monacoTheme = useMonacoTheme(effectiveTheme);

  const sidebar = useResizableWidth({
    storageKey: 'runhq.cross-diff.sidebar.v1',
    defaultWidth: 360,
    min: 320,
    max: 600,
  });

  const [buckets, setBuckets] = useState<Record<string, ServiceBucket>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [viewMode, setViewMode] = useState<DiffViewMode>('side-by-side');
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [search, setSearch] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const dirtyProjects = useMemo<ProjectOverview[]>(
    () => (overview?.projects ?? []).filter((p) => p.git_status?.is_dirty),
    [overview],
  );

  const serviceCwdById = useMemo(() => {
    const m = new Map<string, string>();
    for (const svc of services) m.set(svc.id, svc.cwd);
    return m;
  }, [services]);

  // Esc closes, F11 / ⌘⇧F toggles fullscreen — mirrors DiffViewer's
  // shortcut set so muscle memory transfers between the two surfaces.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'F11' || (e.key === 'f' && (e.metaKey || e.ctrlKey) && e.shiftKey)) {
        e.preventDefault();
        setIsFullscreen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fetch every dirty project's unstaged + staged diffs in parallel when
  // the viewer opens (and whenever Refresh bumps refreshTick). We don't
  // tie this to individual service expansion because the tree view shows
  // counts per service up-front and they'd be wrong without the data.
  useEffect(() => {
    let cancelled = false;
    const ids = dirtyProjects.map((p) => p.service_id);
    if (ids.length === 0) {
      setBuckets({});
      return;
    }
    setBuckets((prev) => {
      const next = { ...prev };
      for (const p of dirtyProjects) {
        next[p.service_id] = {
          project: p,
          unstaged: prev[p.service_id]?.unstaged ?? null,
          staged: prev[p.service_id]?.staged ?? null,
          loading: true,
          error: null,
        };
      }
      // Drop stale buckets (project is no longer dirty).
      for (const id of Object.keys(next)) {
        if (!ids.includes(id)) delete next[id];
      }
      return next;
    });

    void Promise.all(
      dirtyProjects.map(async (p) => {
        try {
          const [u, s] = await Promise.all([
            ipc.gitDiff(p.service_id),
            ipc.gitDiffStaged(p.service_id),
          ]);
          if (cancelled) return;
          setBuckets((prev) => ({
            ...prev,
            [p.service_id]: {
              project: p,
              unstaged: u,
              staged: s,
              loading: false,
              error: null,
            },
          }));
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setBuckets((prev) => ({
            ...prev,
            [p.service_id]: {
              project: p,
              unstaged: null,
              staged: null,
              loading: false,
              error: msg,
            },
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [dirtyProjects, refreshTick]);

  // "Full file" toggle observed here so the diff refetches with a huge
  // `-U` context when the user flips it on — see DiffViewer for the
  // 100k rationale.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Load the body of whichever diff is currently selected. Keyed on the
  // full selection so switching between files (or between unstaged/staged
  // versions of the same file) always re-fetches.
  useEffect(() => {
    if (!selection) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    (async () => {
      try {
        const raw =
          selection.source === 'staged'
            ? await ipc.gitDiffFileStaged(selection.serviceId, selection.path, fullFileContext)
            : await ipc.gitDiffFile(selection.serviceId, selection.path, fullFileContext);
        if (!cancelled) setFileDiff(raw);
      } catch (err) {
        if (!cancelled) {
          console.error('Cross-project file diff failed', err);
          setFileDiff(null);
        }
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, fullFileContext]);

  // Build tree data once per bucket + search, cache locally so re-renders
  // from selection don't repeatedly walk the file list.
  type ServiceTree = {
    project: ProjectOverview;
    unstagedEntries: FileEntry[];
    stagedEntries: FileEntry[];
    unstagedTree: ReturnType<typeof buildTree>;
    stagedTree: ReturnType<typeof buildTree>;
    totalAdditions: number;
    totalDeletions: number;
    totalFiles: number;
    loading: boolean;
    error: string | null;
  };

  const serviceTrees = useMemo<ServiceTree[]>(() => {
    const q = search.trim().toLowerCase();
    const rows: ServiceTree[] = [];
    for (const p of dirtyProjects) {
      const b = buckets[p.service_id];
      // `FileEntry` is `FileDiff & { section }` — the section string is
      // used elsewhere for display grouping, so tag each file with the
      // staging bucket it came from to match the contract.
      const unstaged: FileEntry[] = (b?.unstaged?.files ?? []).map((f) => ({
        ...f,
        section: 'Changes',
      }));
      const staged: FileEntry[] = (b?.staged?.files ?? []).map((f) => ({
        ...f,
        section: 'Staged',
      }));
      const filter = (f: FileEntry) =>
        !q || f.path.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
      const fu = unstaged.filter(filter);
      const fs = staged.filter(filter);
      // Suppress services that search-filtered to empty but weren't empty
      // before, so typing in the search narrows the list without leaving
      // misleading "0 files" service headers behind.
      if (q && fu.length === 0 && fs.length === 0) continue;
      rows.push({
        project: p,
        unstagedEntries: fu,
        stagedEntries: fs,
        unstagedTree: buildTree(fu),
        stagedTree: buildTree(fs),
        totalAdditions:
          fu.reduce((a, f) => a + f.additions, 0) + fs.reduce((a, f) => a + f.additions, 0),
        totalDeletions:
          fu.reduce((a, f) => a + f.deletions, 0) + fs.reduce((a, f) => a + f.deletions, 0),
        totalFiles: fu.length + fs.length,
        loading: b?.loading ?? true,
        error: b?.error ?? null,
      });
    }
    return rows;
  }, [dirtyProjects, buckets, search]);

  // On first data load, expand all folders for every service so the user
  // sees everything at a glance. Subsequent expands/collapses are user-
  // driven and preserved across refreshes.
  const [didInitExpand, setDidInitExpand] = useState(false);
  useEffect(() => {
    if (didInitExpand) return;
    if (serviceTrees.every((s) => s.loading)) return;
    const next = new Set<string>();
    for (const s of serviceTrees) {
      collectFolderPaths(s.unstagedTree, next);
      collectFolderPaths(s.stagedTree, next);
    }
    setExpandedFolders(next);
    setDidInitExpand(true);
  }, [serviceTrees, didInitExpand]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleService = useCallback((id: string) => {
    setCollapsedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    for (const s of serviceTrees) {
      collectFolderPaths(s.unstagedTree, next);
      collectFolderPaths(s.stagedTree, next);
    }
    setExpandedFolders(next);
    setCollapsedServices(new Set());
  }, [serviceTrees]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
    setCollapsedServices(new Set(serviceTrees.map((s) => s.project.service_id)));
  }, [serviceTrees]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const selectedMeta = useMemo<FileEntry | null>(() => {
    if (!selection) return null;
    const bucket = buckets[selection.serviceId];
    if (!bucket) return null;
    const pool = selection.source === 'staged' ? bucket.staged?.files : bucket.unstaged?.files;
    const hit = (pool ?? []).find((f) => f.path === selection.path);
    if (!hit) return null;
    return { ...hit, section: selection.source === 'staged' ? 'Staged' : 'Changes' };
  }, [selection, buckets]);

  const totalServices = serviceTrees.length;
  const totalFiles = serviceTrees.reduce((a, s) => a + s.totalFiles, 0);
  const totalAdditions = serviceTrees.reduce((a, s) => a + s.totalAdditions, 0);
  const totalDeletions = serviceTrees.reduce((a, s) => a + s.totalDeletions, 0);
  const anyLoading = serviceTrees.some((s) => s.loading);

  const selectedServiceCwd = selection ? (serviceCwdById.get(selection.serviceId) ?? null) : null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm',
        isFullscreen ? 'items-stretch justify-stretch' : 'items-center justify-center',
      )}
    >
      <div
        className={cn(
          'bg-surface-raised border-border flex flex-col overflow-hidden shadow-2xl',
          isFullscreen
            ? 'h-full w-full rounded-none border-0'
            : 'h-[88vh] w-[96vw] min-w-[1000px] rounded-lg border',
        )}
      >
        {/* Titlebar */}
        <div
          {...(isFullscreen && isMac ? { 'data-tauri-drag-region': true } : {})}
          className={cn(
            'border-border flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-3',
            isFullscreen && isMac ? 'pl-[84px]' : 'pl-3',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch size={15} className="text-accent shrink-0" />
            <h2 className="text-fg shrink-0 text-[13px] font-semibold whitespace-nowrap">
              Uncommitted Across Projects
            </h2>
            <span className="text-fg/30 shrink-0">·</span>
            <span className="text-fg/60 flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
              <span>
                {totalServices} project{totalServices === 1 ? '' : 's'}
              </span>
              <span className="text-fg/30">·</span>
              <span>
                {totalFiles} file{totalFiles === 1 ? '' : 's'}
              </span>
              {(totalAdditions > 0 || totalDeletions > 0) && (
                <>
                  <span className="text-fg/30">·</span>
                  <span>
                    {totalAdditions > 0 && (
                      <span className="text-emerald-400">+{totalAdditions}</span>
                    )}
                    {totalAdditions > 0 && totalDeletions > 0 && (
                      <span className="text-fg/30"> </span>
                    )}
                    {totalDeletions > 0 && <span className="text-rose-400">−{totalDeletions}</span>}
                  </span>
                </>
              )}
              {anyLoading && <RefreshCw size={11} className="text-fg/30 ml-1 animate-spin" />}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconTool
              onClick={refresh}
              tooltip="Refresh diffs"
              disabled={anyLoading}
              icon={<RefreshCw size={13} className={anyLoading ? 'animate-spin' : ''} />}
            />
            <div className="bg-border/60 mx-1 h-5 w-px" />
            <IconTool
              onClick={() => setViewMode('side-by-side')}
              tooltip="Side-by-side"
              active={viewMode === 'side-by-side'}
              icon={<Columns2 size={13} />}
            />
            <IconTool
              onClick={() => setViewMode('inline')}
              tooltip="Inline"
              active={viewMode === 'inline'}
              icon={<Rows2 size={13} />}
            />
            <div className="bg-border/60 mx-1 h-5 w-px" />
            <IconTool
              onClick={expandAll}
              tooltip="Expand all"
              icon={<UnfoldVertical size={13} />}
            />
            <IconTool
              onClick={collapseAll}
              tooltip="Collapse all"
              icon={<FoldVertical size={13} />}
            />
            <div className="bg-border/60 mx-1 h-5 w-px" />
            <IconTool
              onClick={() => setIsFullscreen((v) => !v)}
              tooltip={isFullscreen ? 'Restore' : 'Fullscreen (F11)'}
              icon={isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            />
            <IconTool onClick={onClose} tooltip="Close (Esc)" icon={<X size={14} />} />
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left: scope sidebar with search + service sections — resizable 260–720px. */}
          <aside
            className="border-border flex shrink-0 flex-col border-r"
            style={{ width: sidebar.width }}
          >
            <div className="border-border shrink-0 border-b p-2">
              <div className="relative">
                <Search
                  size={12}
                  className="text-fg/40 pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by file or project…"
                  className="border-border bg-surface text-fg placeholder:text-fg/40 focus:border-accent/60 h-7 w-full rounded border pr-6 pl-7 text-[12px] transition focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="text-fg/40 hover:text-fg absolute top-1/2 right-1.5 -translate-y-1/2"
                    aria-label="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {serviceTrees.length === 0 && <EmptyState search={search} anyLoading={anyLoading} />}
              {serviceTrees.map((s) => (
                <ServiceSection
                  key={s.project.service_id}
                  tree={s}
                  collapsed={collapsedServices.has(s.project.service_id)}
                  expandedFolders={expandedFolders}
                  onToggleService={() => toggleService(s.project.service_id)}
                  onToggleFolder={toggleFolder}
                  selection={selection}
                  onSelect={(src, path) =>
                    setSelection({ serviceId: s.project.service_id, source: src, path })
                  }
                  onOpenInDiffViewer={() => {
                    openDiffViewer(s.project.service_id);
                    closeCrossProjectDiff();
                  }}
                />
              ))}
            </div>
          </aside>

          <ResizeHandle
            handleProps={sidebar.handleProps}
            dragging={sidebar.dragging}
            title="Drag to resize file explorer · double-click to reset"
          />

          {/* Right: diff viewport */}
          <main className="flex min-w-0 flex-1 flex-col">
            <DiffPane
              selectedFile={selection?.path ?? null}
              fileDiff={fileDiff}
              selectedMeta={selectedMeta}
              monacoTheme={monacoTheme}
              cwd={selectedServiceCwd}
              viewMode={viewMode}
              fileLoading={fileLoading}
              emptyLabel={
                totalFiles === 0
                  ? '🎉 All your projects are clean'
                  : 'Select a file from the sidebar to view its diff'
              }
            />
          </main>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ search, anyLoading }: { search: string; anyLoading: boolean }) {
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

interface ServiceSectionProps {
  tree: {
    project: ProjectOverview;
    unstagedEntries: FileEntry[];
    stagedEntries: FileEntry[];
    unstagedTree: ReturnType<typeof buildTree>;
    stagedTree: ReturnType<typeof buildTree>;
    totalAdditions: number;
    totalDeletions: number;
    totalFiles: number;
    loading: boolean;
    error: string | null;
  };
  collapsed: boolean;
  expandedFolders: Set<string>;
  onToggleService: () => void;
  onToggleFolder: (path: string) => void;
  selection: Selection | null;
  onSelect: (source: 'unstaged' | 'staged', path: string) => void;
  onOpenInDiffViewer: () => void;
}

function ServiceSection({
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
      {/* Service header — click to collapse, hover reveals Open-in-DiffViewer */}
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

          {/* Staged block */}
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

          {/* Unstaged / Changes block */}
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

function StagingBlock({
  label,
  hintIcon,
  count,
  tree,
  expandedFolders,
  onToggleFolder,
  selection,
  serviceId,
  source,
  onSelect,
}: {
  label: string;
  hintIcon: React.ReactNode;
  count: number;
  tree: ReturnType<typeof buildTree>;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  selection: Selection | null;
  serviceId: string;
  source: 'unstaged' | 'staged';
  onSelect: (source: 'unstaged' | 'staged', path: string) => void;
}) {
  // TreeView takes a single `selectedFile` string for highlighting, but
  // the cross-project view needs to disambiguate between services AND
  // between staged/unstaged panes. Feeding null when the active selection
  // lives in a different block keeps the highlight scoped to the one it
  // belongs to — otherwise every file with the same relative path across
  // projects would light up at once.
  const selectedFileForThisBlock =
    selection && selection.serviceId === serviceId && selection.source === source
      ? selection.path
      : null;

  return (
    <div className="border-border/40 border-t first:border-t-0">
      <div className="text-fg/50 flex items-center gap-1.5 px-3 py-1 text-[10px] tracking-wide uppercase">
        <span className="text-fg/40">{hintIcon}</span>
        <span>{label}</span>
        <span className="text-fg/40 tabular-nums">{count}</span>
      </div>
      <TreeView
        node={tree}
        level={0}
        expanded={expandedFolders}
        onToggle={onToggleFolder}
        selectedFile={selectedFileForThisBlock}
        onSelect={(path) => onSelect(source, path)}
      />
    </div>
  );
}

function IconTool({
  onClick,
  tooltip,
  icon,
  active,
  disabled,
}: {
  onClick: () => void;
  tooltip: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition',
        active ? 'bg-accent/20 text-accent' : 'text-fg/50 hover:text-fg hover:bg-fg/10',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {icon}
    </button>
  );
}
