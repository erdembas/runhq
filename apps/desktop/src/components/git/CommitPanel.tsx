import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ipc } from '@/lib/ipc';
import { type FileEntry, buildTree } from '@/lib/gitDiff';
import { useAppStore } from '@/store/useAppStore';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { DiffPane, type DiffViewMode } from '@/components/git/DiffPane';
import { ResizeHandle } from '@/components/ui/ResizeHandle';
import { FileContextMenu } from '@/components/ui/FileContextMenu';
import { CommitComposer } from '@/components/git/commit-panel/CommitComposer';
import { CommitDiscardDialog } from '@/components/git/commit-panel/CommitDiscardDialog';
import { CommitFileList } from '@/components/git/commit-panel/CommitFileList';
import { CommitToolbar } from '@/components/git/commit-panel/CommitToolbar';
import { useCommitContextMenu } from '@/components/git/commit-panel/useCommitContextMenu';
import { useCommitMessageGenerator } from '@/components/git/commit-panel/useCommitMessageGenerator';
import { useCommitPanelStore, useCommitPanelStoreRef } from './useCommitPanelStore';
import type { ServiceId } from '@/types';

interface CommitPanelProps {
  serviceId: ServiceId;
  cwd: string | null;
  monacoTheme: string;
  viewMode: DiffViewMode;
  /** Bumped by the parent after external refreshes (e.g. git status chip),
   * so every panel reloads in sync. */
  refreshTick: number;
  onAfterMutation: () => void;
}

export function CommitPanel({
  serviceId,
  cwd,
  monacoTheme,
  viewMode,
  refreshTick,
  onAfterMutation,
}: CommitPanelProps) {
  const store = useCommitPanelStoreRef();
  const panel = useCommitPanelStore(store, (state) => state);
  const patch = panel.patch;
  const expandTrees = panel.expandTrees;
  const expandAllFolders = panel.expandAll;
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const previousAmendRef = useRef(panel.amend);

  // Right-click menu — opened by setting `ctxMenu` from FileRow's
  // onContextMenu handler. Holding the file + which side it was on so
  // the menu items can stage/unstage/discard correctly without having
  // to reach into the tree.
  // Discard confirmation. Two flavours:
  //   - tracked changes  → `git checkout HEAD -- path`        (irreversible but recoverable from reflog if needed)
  //   - untracked file   → filesystem deletion via `git clean` (irreversible AND not in any git history)
  // The untracked path uses a `confirmWord` gate to prevent muscle-memory.
  const sidebar = useResizableWidth({
    storageKey: 'runhq.diff.commit.sidebar.v1',
    defaultWidth: 320,
    min: 320,
    max: 600,
  });

  const reload = useCallback(async () => {
    patch({ loading: true });
    try {
      const [u, s, st] = await Promise.all([
        ipc.gitDiff(serviceId),
        ipc.gitDiffStaged(serviceId),
        ipc.gitStatus(serviceId),
      ]);
      patch({ unstaged: u, staged: s, gitStatus: st });
    } catch (err) {
      console.error('Failed to reload commit panel', err);
    } finally {
      patch({ loading: false });
    }
  }, [patch, serviceId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshTick]);

  // Pre-fill message with the previous commit's subject when the user
  // turns on Amend. We only touch it if the box is empty so typed drafts
  // aren't clobbered.
  useEffect(() => {
    const amendWasEnabled = !previousAmendRef.current && panel.amend;
    previousAmendRef.current = panel.amend;
    if (amendWasEnabled && panel.gitStatus?.last_commit && panel.message.trim() === '') {
      patch({ message: panel.gitStatus.last_commit.subject });
    }
  }, [panel.amend, panel.gitStatus, panel.message, patch]);

  // Build trees for each section. We keep `*EntriesAll` for stage/unstage
  // actions and counts-of-truth, while `*Entries` is the search-filtered
  // view used to drive the visible tree. Splitting the two means typing
  // into the search box never blocks "Stage all" — that always operates
  // on the full set, matching how VSCode behaves.
  const stagedEntriesAll: FileEntry[] = useMemo(
    () => panel.staged?.files.map((f) => ({ ...f, section: 'Staged' })) ?? [],
    [panel.staged],
  );
  const unstagedEntriesAll: FileEntry[] = useMemo(
    () => panel.unstaged?.files.map((f) => ({ ...f, section: 'Changes' })) ?? [],
    [panel.unstaged],
  );

  const fileSearchTrim = panel.fileSearch.trim().toLowerCase();
  const matchPath = useCallback(
    (path: string) => fileSearchTrim === '' || path.toLowerCase().includes(fileSearchTrim),
    [fileSearchTrim],
  );
  const stagedEntries = useMemo(
    () => stagedEntriesAll.filter((f) => matchPath(f.path)),
    [stagedEntriesAll, matchPath],
  );
  const unstagedEntries = useMemo(
    () => unstagedEntriesAll.filter((f) => matchPath(f.path)),
    [unstagedEntriesAll, matchPath],
  );
  const stagedTree = useMemo(() => buildTree(stagedEntries), [stagedEntries]);
  const unstagedTree = useMemo(() => buildTree(unstagedEntries), [unstagedEntries]);

  // Auto-expand every folder when the visible set changes (data refresh
  // or search edit) — when typing a search query users want matches
  // visible immediately, no extra clicks.
  useEffect(() => {
    expandTrees([stagedTree, unstagedTree]);
  }, [expandTrees, stagedTree, unstagedTree]);

  const expandAll = useCallback(() => {
    expandAllFolders([stagedTree, unstagedTree]);
  }, [expandAllFolders, stagedTree, unstagedTree]);

  // Huge context for "Full file" view — see DiffViewer for rationale.
  const showUnchanged = useAppStore((s) => s.diffShowUnchanged);
  const fullFileContext = showUnchanged ? 100_000 : undefined;

  // Load selected file's diff (staged or working tree).
  useEffect(() => {
    const selected = panel.selected;
    if (!selected) {
      patch({ fileDiff: null });
      return;
    }
    let cancelled = false;
    patch({ fileLoading: true });
    (async () => {
      try {
        const raw =
          selected.kind === 'staged'
            ? await ipc.gitDiffFileStaged(serviceId, selected.path, fullFileContext)
            : await ipc.gitDiffFile(serviceId, selected.path, fullFileContext);
        if (!cancelled) patch({ fileDiff: raw });
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load file diff', err);
          patch({ fileDiff: null });
        }
      } finally {
        if (!cancelled) patch({ fileLoading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, panel.selected, fullFileContext, patch]);

  const selectedMeta: FileEntry | null = useMemo(() => {
    if (!panel.selected) return null;
    const list = panel.selected.kind === 'staged' ? stagedEntriesAll : unstagedEntriesAll;
    return list.find((f) => f.path === panel.selected?.path) ?? null;
  }, [panel.selected, stagedEntriesAll, unstagedEntriesAll]);

  const runMutation = useCallback(
    async (fn: () => Promise<void>) => {
      patch({ error: null });
      try {
        await fn();
        onAfterMutation();
        await reload();
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : String(err) });
      }
    },
    [onAfterMutation, patch, reload],
  );

  const stageFile = useCallback(
    (path: string) => runMutation(() => ipc.gitStageFile(serviceId, path)),
    [serviceId, runMutation],
  );
  const unstageFile = useCallback(
    (path: string) => runMutation(() => ipc.gitUnstageFile(serviceId, path)),
    [serviceId, runMutation],
  );
  const stageAll = useCallback(
    () => runMutation(() => ipc.gitStageAll(serviceId)),
    [serviceId, runMutation],
  );
  const unstageAll = useCallback(
    () => runMutation(() => ipc.gitUnstageAll(serviceId)),
    [serviceId, runMutation],
  );
  const discardFile = useCallback(
    (path: string) => runMutation(() => ipc.gitDiscardFile(serviceId, path)),
    [serviceId, runMutation],
  );

  const buildContextMenu = useCommitContextMenu({
    cwd,
    patch,
    onStageFile: stageFile,
    onUnstageFile: unstageFile,
  });

  const canCommit =
    !panel.committing &&
    (panel.message.trim().length > 0 || panel.amend) &&
    (stagedEntriesAll.length > 0 || panel.amend);

  const commitNow = useCallback(async () => {
    if (!canCommit) return;
    patch({ committing: true, error: null });
    try {
      await ipc.gitCommit(serviceId, panel.message.trim(), panel.amend);
      patch({ message: '', amend: false });
      onAfterMutation();
      await reload();
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ committing: false });
    }
  }, [serviceId, panel.message, panel.amend, canCommit, onAfterMutation, patch, reload]);

  const { generateButtonRef, generateMessage, runGenerate } = useCommitMessageGenerator({
    serviceId,
    panel,
    patch,
    stagedCount: stagedEntriesAll.length,
    messageRef,
  });

  const pushNow = useCallback(async () => {
    patch({ pushing: true, error: null });
    try {
      await ipc.gitPush(serviceId, panel.amend);
      onAfterMutation();
      await reload();
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ pushing: false });
    }
  }, [serviceId, panel.amend, onAfterMutation, patch, reload]);

  // Cmd/Ctrl+Enter commits from the message textarea.
  const onKeyDownMessage = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void commitNow();
    }
  };

  const ahead = panel.gitStatus?.ahead ?? 0;
  const behind = panel.gitStatus?.behind ?? 0;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: commit compose + file lists — resizable, 240–720px. */}
      <div
        className="border-border flex shrink-0 flex-col border-r"
        style={{ width: sidebar.width }}
      >
        <CommitComposer
          panel={panel}
          patch={patch}
          messageRef={messageRef}
          generateButtonRef={generateButtonRef}
          stagedCount={stagedEntriesAll.length}
          ahead={ahead}
          behind={behind}
          canCommit={canCommit}
          onCommit={() => void commitNow()}
          onPush={() => void pushNow()}
          onGenerate={() => void generateMessage()}
          onGenerateWithProvider={(provider) => void runGenerate(provider)}
          onMessageKeyDown={onKeyDownMessage}
        />
        <CommitToolbar
          treeMode={panel.treeMode}
          onToggleTreeMode={panel.toggleTreeMode}
          onExpandAll={expandAll}
          onCollapseAll={panel.collapseAll}
        />
        <CommitFileList
          panel={panel}
          patch={patch}
          stagedEntries={stagedEntries}
          stagedEntriesAll={stagedEntriesAll}
          unstagedEntries={unstagedEntries}
          unstagedEntriesAll={unstagedEntriesAll}
          stagedTree={stagedTree}
          unstagedTree={unstagedTree}
          searching={fileSearchTrim.length > 0}
          onStageAll={() => void stageAll()}
          onUnstageAll={() => void unstageAll()}
          onStageFile={(path) => void stageFile(path)}
          onUnstageFile={(path) => void unstageFile(path)}
        />
      </div>

      <ResizeHandle
        handleProps={sidebar.handleProps}
        dragging={sidebar.dragging}
        title="Drag to resize file explorer · double-click to reset"
      />

      {/* Right: diff of the selected file */}
      <div className="flex min-w-0 flex-1 flex-col">
        <DiffPane
          selectedFile={panel.selected?.path ?? null}
          fileDiff={panel.fileDiff}
          selectedMeta={selectedMeta}
          monacoTheme={monacoTheme}
          cwd={cwd}
          viewMode={viewMode}
          fileLoading={panel.fileLoading}
          emptyLabel={
            stagedEntries.length + unstagedEntries.length === 0
              ? 'Working tree is clean. Nothing to commit.'
              : 'Select a file to view its changes'
          }
        />
      </div>

      {panel.ctxMenu && (
        <FileContextMenu
          x={panel.ctxMenu.x}
          y={panel.ctxMenu.y}
          items={buildContextMenu(panel.ctxMenu.file, panel.ctxMenu.side)}
          onClose={panel.closeContextMenu}
        />
      )}

      <CommitDiscardDialog panel={panel} patch={patch} onDiscardFile={discardFile} />
    </div>
  );
}
