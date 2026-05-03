import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrossProjectDiffSidebar } from '@/components/cross-project-diff/CrossProjectDiffSidebar';
import { CrossProjectDiffTitlebar } from '@/components/cross-project-diff/CrossProjectDiffTitlebar';
import { RIGHT_RAIL_WIDTH, isMac } from '@/components/cross-project-diff/constants';
import type { Selection, ServiceBucket, ServiceTree } from '@/components/cross-project-diff/types';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import { useTheme } from '@/lib/theme';
import { useMonacoTheme } from '@/lib/monacoTheme';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { useAppStore } from '@/store/useAppStore';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { type FileEntry, buildTree, collectFolderPaths } from '@/lib/gitDiff';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import type { ProjectOverview } from '@/types';

interface Props {
  onClose: () => void;
}

export function CrossProjectDiffViewer({ onClose }: Props) {
  const overview = useAppStore((s) => s.overview);
  const services = useAppStore((s) => s.services);
  const openDiffViewer = useAppStore((s) => s.openDiffViewer);
  const closeCrossProjectDiff = useAppStore((s) => s.closeCrossProjectDiff);

  // Reserve right-edge space for the always-visible activity rail and
  // the AI / Activity panel (when open) — same rationale as DiffViewer:
  // clicking "Explain" inside this view used to pop the AI panel
  // *behind* the overlay, leaving the user staring at a diff with no
  // streamed answer in sight. Only applied in fullscreen mode; the
  // windowed mode already has natural margins on both sides.
  const rightPanel = useAppStore((s) => s.rightPanel);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const reservedRight = RIGHT_RAIL_WIDTH + (rightPanel ? rightPanelWidth : 0);

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
        'fixed top-0 bottom-0 left-0 z-50 flex bg-black/60 backdrop-blur-sm',
        isFullscreen ? 'items-stretch justify-stretch' : 'items-center justify-center',
      )}
      // In fullscreen we leave room for the global right rail (Activity
      // Bar + open side panel), so AI/Activity panels triggered from
      // inside the diff (e.g. "Explain") stay visible alongside it. In
      // windowed mode the inner card already has whitespace margins, so
      // the backdrop spans the full viewport — keeps the centred dim
      // effect symmetrical and stops the rail's edge from poking out
      // into a half-tinted strip.
      style={isFullscreen ? { right: reservedRight } : undefined}
    >
      <div
        className={cn(
          'bg-surface-raised border-border flex flex-col overflow-hidden shadow-2xl',
          isFullscreen
            ? 'h-full w-full rounded-none border-0'
            : 'h-[88vh] w-[96vw] min-w-[1000px] rounded-lg border',
        )}
      >
        <CrossProjectDiffTitlebar
          isFullscreen={isFullscreen}
          isMac={isMac}
          totalServices={totalServices}
          totalFiles={totalFiles}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          anyLoading={anyLoading}
          viewMode={viewMode}
          onRefresh={refresh}
          onViewModeChange={setViewMode}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onToggleFullscreen={() => setIsFullscreen((v) => !v)}
          onClose={onClose}
        />

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <CrossProjectDiffSidebar
            width={sidebar.width}
            search={search}
            serviceTrees={serviceTrees}
            anyLoading={anyLoading}
            collapsedServices={collapsedServices}
            expandedFolders={expandedFolders}
            selection={selection}
            onSearchChange={setSearch}
            onToggleService={toggleService}
            onToggleFolder={toggleFolder}
            onSelect={(serviceId, source, path) => setSelection({ serviceId, source, path })}
            onOpenInDiffViewer={(serviceId) => {
              openDiffViewer(serviceId);
              closeCrossProjectDiff();
            }}
          />

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
