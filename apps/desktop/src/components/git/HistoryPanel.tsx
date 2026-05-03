import { useEffect, useMemo, useRef } from 'react';
import { FolderTree, History } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { type FileEntry, buildTree } from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { usePersistentBoolean } from '@/lib/usePersistentBoolean';
import type { DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import type { BranchPickerOption } from '@/components/ui/BranchPicker';
import { CollapsedRail } from '@/components/git/CollapsedRail';
import { buildCommitChatPayload } from '@/lib/ai/diffPayload';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { HistoryChangedFilesPanel } from '@/components/git/history-panel/HistoryChangedFilesPanel';
import { HistoryCommitList } from '@/components/git/history-panel/HistoryCommitList';
import { HistoryFileDiff } from '@/components/git/history-panel/HistoryFileDiff';
import { useHistoryPanelStore, useHistoryPanelStoreRef } from './useHistoryPanelStore';
import type { ServiceId } from '@/types';

interface HistoryPanelProps {
  serviceId: ServiceId;
  cwd: string | null;
  monacoTheme: string;
  viewMode: DiffViewMode;
  refreshTick: number;
}

export function HistoryPanel({
  serviceId,
  cwd,
  monacoTheme,
  viewMode,
  refreshTick,
}: HistoryPanelProps) {
  const store = useHistoryPanelStoreRef();
  const panel = useHistoryPanelStore(store, (state) => state);
  const patch = panel.patch;
  const expandTree = panel.expandTree;

  const commitsSidebar = useResizableWidth({
    storageKey: 'runhq.diff.history.commits.v1',
    defaultWidth: 320,
    // Lowered from 320 → 240. With AI / Activity rails open the
    // History view runs out of horizontal pixels fast; 240 is the
    // floor where commit subjects still truncate gracefully and
    // the avatar + hash + timeago row stays readable. Users who
    // need more breathing room can collapse the panel entirely
    // with the chevron in the header.
    min: 240,
    max: 600,
  });
  const filesSidebar = useResizableWidth({
    storageKey: 'runhq.diff.history.files.v1',
    defaultWidth: 320,
    // Same logic as the commits sidebar — 240 keeps the file tree
    // legible (path columns truncate, change-stats stay aligned)
    // while making room for the diff pane to be the star.
    min: 240,
    max: 600,
  });
  const [commitsCollapsed, setCommitsCollapsed] = usePersistentBoolean(
    'runhq.diff.history.commits.collapsed.v1',
    false,
  );
  const [filesCollapsed, setFilesCollapsed] = usePersistentBoolean(
    'runhq.diff.history.files.collapsed.v1',
    false,
  );

  // Load the commit list whenever the branch filter or refresh tick flips.
  useEffect(() => {
    let cancelled = false;
    patch({ loading: true });
    (async () => {
      try {
        const [list, brs] = await Promise.all([
          ipc.gitLog(
            serviceId,
            panel.branchFilter === '__head__'
              ? null
              : panel.branchFilter === '__all__'
                ? '--all'
                : panel.branchFilter,
            200,
          ),
          ipc.gitBranches(serviceId),
        ]);
        if (cancelled) return;
        patch((state) => ({
          commits: list,
          branches: brs,
          // Auto-select the most recent commit so the diff pane isn't empty.
          selectedCommit: list.length > 0 ? (state.selectedCommit ?? list[0] ?? null) : null,
        }));
      } catch (err) {
        console.error('Failed to load history', err);
      } finally {
        if (!cancelled) patch({ loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, panel.branchFilter, refreshTick, patch]);

  // Load diff summary for the selected commit.
  useEffect(() => {
    if (!panel.selectedCommit) {
      patch({ commitDiff: null, selectedFile: null });
      return;
    }
    let cancelled = false;
    patch({ commitDiffLoading: true });
    (async () => {
      try {
        const diff = await ipc.gitShowCommit(serviceId, panel.selectedCommit!.hash_full);
        if (cancelled) return;
        patch({ commitDiff: diff, selectedFile: diff.files[0]?.path ?? null });
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to show commit', err);
          patch({ commitDiff: null });
        }
      } finally {
        if (!cancelled) patch({ commitDiffLoading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, panel.selectedCommit, patch]);

  // "Full file" toggle observed here so commit diffs also get the big
  // `-U` context when it's on.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Load raw diff for the selected file inside the selected commit.
  useEffect(() => {
    if (!panel.selectedCommit || !panel.selectedFile) {
      patch({ fileDiff: null });
      return;
    }
    let cancelled = false;
    patch({ fileLoading: true });
    (async () => {
      try {
        const raw = await ipc.gitDiffCommitFile(
          serviceId,
          panel.selectedCommit!.hash_full,
          panel.selectedFile!,
          fullFileContext,
        );
        if (!cancelled) patch({ fileDiff: raw });
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load commit file diff', err);
          patch({ fileDiff: null });
        }
      } finally {
        if (!cancelled) patch({ fileLoading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, panel.selectedCommit, panel.selectedFile, fullFileContext, patch]);

  // "Explain commit" — asks the AI about the commit as a whole, not
  // file-by-file. We pull every file's diff in parallel only when the
  // user actually clicks (lazy on purpose: a 50-file vendor bump
  // shouldn't fire 50 IPC calls just because the user happened to
  // select that commit). The `useAiSurfaceTrigger` hook handles the
  // model-picker popover for multi-provider setups and dispatches
  // immediately on single-provider ones — same UX as every other AI
  // surface, kept consistent so the muscle memory transfers.
  //
  // Refs capture the freshest commit + file metadata so a re-render
  // mid-fetch (e.g. user scrolled the commit list) doesn't freeze a
  // stale snapshot into the prompt builder.
  const selectedCommitRef = useRef(panel.selectedCommit);
  selectedCommitRef.current = panel.selectedCommit;
  const commitDiffRef = useRef(panel.commitDiff);
  commitDiffRef.current = panel.commitDiff;
  const {
    triggerRef: explainCommitTriggerRef,
    onClick: triggerExplainCommit,
    popover: explainCommitPopover,
  } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: async () => {
      const commit = selectedCommitRef.current;
      const summary = commitDiffRef.current;
      if (!commit || !summary) {
        // Defensive — the button is disabled while these are null,
        // but the hook calls buildPayload during its dispatch path
        // so we still want a typed fallback. The empty changeset
        // prompt is at least coherent if it ever ships.
        const payload = buildCommitChatPayload({
          scope: 'commit',
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
        });
        return {
          origin: 'diff',
          title: payload.title,
          context: payload.context,
          draftPrompt: payload.draftPrompt,
          contextSystemMessage: payload.contextSystemMessage,
        };
      }

      // Pull every file's diff in parallel. `Promise.allSettled` so
      // a single bad file (binary, deleted-from-history weirdness)
      // doesn't sink the whole prompt — the failed entries simply
      // get an empty `diff` and the builder marks them as such.
      const fetched = await Promise.allSettled(
        summary.files.map((f) =>
          ipc.gitDiffCommitFile(serviceId, commit.hash_full, f.path).then(
            (raw) => ({ path: f.path, diff: raw }),
            (err) => {
              console.warn(`failed to load diff for ${f.path}:`, err);
              return { path: f.path, diff: '' };
            },
          ),
        ),
      );
      const diffByPath = new Map<string, string>();
      for (const r of fetched) {
        if (r.status === 'fulfilled') {
          diffByPath.set(r.value.path, r.value.diff);
        }
      }

      const payload = buildCommitChatPayload({
        scope: 'commit',
        commit: {
          hashShort: commit.hash_short,
          hashFull: commit.hash_full,
          subject: commit.subject,
          author: commit.author,
          timestamp: commit.timestamp,
        },
        files: summary.files.map((f) => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          diff: diffByPath.get(f.path) ?? '',
        })),
        totalAdditions: summary.total_additions,
        totalDeletions: summary.total_deletions,
      });
      return {
        origin: 'diff',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  const files: FileEntry[] = useMemo(
    () =>
      panel.commitDiff?.files.map((f) => ({
        ...f,
        section: panel.selectedCommit?.hash_short ?? '',
      })) ?? [],
    [panel.commitDiff, panel.selectedCommit],
  );
  const tree = useMemo(() => buildTree(files), [files]);

  useEffect(() => {
    expandTree(tree);
  }, [expandTree, tree]);

  const selectedMeta: FileEntry | null = useMemo(
    () => files.find((f) => f.path === panel.selectedFile) ?? null,
    [files, panel.selectedFile],
  );

  // Client-side commit search — matches subject, author, email, and
  // both short/full hashes. Fast enough for the 200-commit cap we
  // currently load without server-side filtering.
  const commitSearchTrim = panel.commitSearch.trim().toLowerCase();
  const filteredCommits = useMemo(() => {
    if (!commitSearchTrim) return panel.commits;
    return panel.commits.filter((c) => {
      const haystack = [c.subject, c.author, c.email, c.hash_short, c.hash_full, ...c.refs]
        .join(' ')
        .toLowerCase();
      return haystack.includes(commitSearchTrim);
    });
  }, [panel.commits, commitSearchTrim]);

  const branchOptions: BranchPickerOption[] = useMemo(() => {
    const out: BranchPickerOption[] = [
      { value: '__head__', label: 'Current HEAD' },
      { value: '__all__', label: 'All branches' },
    ];
    for (const b of panel.branches) {
      out.push({ value: b, label: b, group: 'Branches' });
    }
    return out;
  }, [panel.branches]);

  return (
    <div className="flex min-h-0 flex-1">
      {commitsCollapsed ? (
        <CollapsedRail
          icon={<History size={12} />}
          label="Commits"
          badge={
            commitSearchTrim
              ? `${filteredCommits.length}/${panel.commits.length}`
              : panel.commits.length || undefined
          }
          title="Show commit list"
          onExpand={() => setCommitsCollapsed(false)}
        />
      ) : (
        <HistoryCommitList
          panel={panel}
          patch={patch}
          branchOptions={branchOptions}
          filteredCommits={filteredCommits}
          commitSearchTrim={commitSearchTrim}
          width={commitsSidebar.width}
          onCollapse={() => setCommitsCollapsed(true)}
        />
      )}

      {/* The resize handle only makes sense when the panel is
          actually a resizable column. When collapsed to the rail
          there's nothing meaningful to drag, and a 1px grip glued
          to a 28px strip looks broken. */}
      {!commitsCollapsed && (
        <ResizeHandle
          handleProps={commitsSidebar.handleProps}
          dragging={commitsSidebar.dragging}
          title="Drag to resize commit list · double-click to reset"
        />
      )}

      {/* Commit detail + file tree — resizable 240–600px, also
          collapsible. Same rail-or-panel pattern as the commits
          column. We always render *something* in this slot so the
          diff pane can't slide left and steal the rail's space. */}
      {filesCollapsed ? (
        <CollapsedRail
          icon={<FolderTree size={12} />}
          label="Files"
          badge={
            panel.commitDiff && panel.commitDiff.files.length > 0
              ? panel.commitDiff.files.length
              : undefined
          }
          title="Show changed files"
          onExpand={() => setFilesCollapsed(false)}
        />
      ) : (
        <HistoryChangedFilesPanel
          panel={panel}
          patch={patch}
          files={files}
          tree={tree}
          width={filesSidebar.width}
          explainTriggerRef={explainCommitTriggerRef}
          explainPopover={explainCommitPopover}
          onExplainCommit={triggerExplainCommit}
          onCollapse={() => setFilesCollapsed(true)}
        />
      )}

      {!filesCollapsed && (
        <ResizeHandle
          handleProps={filesSidebar.handleProps}
          dragging={filesSidebar.dragging}
          title="Drag to resize file explorer · double-click to reset"
        />
      )}

      <HistoryFileDiff
        panel={panel}
        selectedMeta={selectedMeta}
        monacoTheme={monacoTheme}
        cwd={cwd}
        viewMode={viewMode}
      />
    </div>
  );
}
