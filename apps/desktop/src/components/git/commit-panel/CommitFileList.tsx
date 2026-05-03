import { FileSearchInput } from '@/components/git/shared';
import { CommitFileTreeSection } from '@/components/git/commit-panel/CommitFileTreeSection';
import type { CommitPanelStore } from '@/components/git/useCommitPanelStore';
import type { FileEntry, TreeNode } from '@/lib/gitDiff';

interface CommitFileListProps {
  panel: CommitPanelStore;
  patch: CommitPanelStore['patch'];
  stagedEntries: FileEntry[];
  stagedEntriesAll: FileEntry[];
  unstagedEntries: FileEntry[];
  unstagedEntriesAll: FileEntry[];
  stagedTree: TreeNode;
  unstagedTree: TreeNode;
  searching: boolean;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
}

export function CommitFileList({
  panel,
  patch,
  stagedEntries,
  stagedEntriesAll,
  unstagedEntries,
  unstagedEntriesAll,
  stagedTree,
  unstagedTree,
  searching,
  onStageAll,
  onUnstageAll,
  onStageFile,
  onUnstageFile,
}: CommitFileListProps) {
  return (
    <>
      <FileSearchInput value={panel.fileSearch} onChange={(fileSearch) => patch({ fileSearch })} />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <CommitFileTreeSection
          side="staged"
          title="Staged Changes"
          entries={stagedEntries}
          allEntries={stagedEntriesAll}
          tree={stagedTree}
          panel={panel}
          patch={patch}
          searching={searching}
          emptyLabel="Nothing staged"
          onAllAction={onUnstageAll}
          onFileAction={onUnstageFile}
        />
        <div className="mt-2" />
        <CommitFileTreeSection
          side="unstaged"
          title="Changes"
          entries={unstagedEntries}
          allEntries={unstagedEntriesAll}
          tree={unstagedTree}
          panel={panel}
          patch={patch}
          searching={searching}
          emptyLabel="No changes"
          emptyWhileLoading={panel.loading}
          onAllAction={onStageAll}
          onFileAction={onStageFile}
        />
      </div>
    </>
  );
}
