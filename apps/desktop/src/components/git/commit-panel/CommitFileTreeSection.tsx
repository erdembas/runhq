import { CheckSquare, Minus, Plus } from 'lucide-react';
import { TreeView } from '@/components/git/shared';
import { CommitFileActionButton } from '@/components/git/commit-panel/CommitFileActionButton';
import { CommitSectionHeader } from '@/components/git/commit-panel/CommitSectionHeader';
import type { CommitPanelSide, CommitPanelStore } from '@/components/git/useCommitPanelStore';
import type { FileEntry, TreeNode } from '@/lib/gitDiff';

interface CommitFileTreeSectionProps {
  side: CommitPanelSide;
  title: string;
  entries: FileEntry[];
  allEntries: FileEntry[];
  tree: TreeNode;
  panel: CommitPanelStore;
  patch: CommitPanelStore['patch'];
  searching: boolean;
  emptyLabel: string;
  emptyWhileLoading?: boolean;
  onAllAction: () => void;
  onFileAction: (path: string) => void;
}

export function CommitFileTreeSection({
  side,
  title,
  entries,
  allEntries,
  tree,
  panel,
  patch,
  searching,
  emptyLabel,
  emptyWhileLoading,
  onAllAction,
  onFileAction,
}: CommitFileTreeSectionProps) {
  const expanded = side === 'staged' ? panel.showStaged : panel.showChanges;
  const selectedFile = panel.selected?.kind === side ? panel.selected.path : null;
  const SectionIcon = side === 'staged' ? Minus : CheckSquare;
  const FileActionIcon = side === 'staged' ? Minus : Plus;
  const fileActionTitle = side === 'staged' ? 'Unstage this file' : 'Stage this file';
  const allActionTitle = side === 'staged' ? 'Unstage all' : 'Stage all';
  const fileActionClass =
    side === 'staged'
      ? 'text-fg/50 hover:bg-fg/10 hover:text-fg'
      : 'text-fg/50 hover:bg-emerald-400/15 hover:text-emerald-400';

  return (
    <>
      <CommitSectionHeader
        title={title}
        count={entries.length}
        totalCount={allEntries.length}
        searching={searching}
        expanded={expanded}
        onToggle={side === 'staged' ? panel.toggleShowStaged : panel.toggleShowChanges}
        actions={
          allEntries.length > 0 && (
            <button
              onClick={() => void onAllAction()}
              className="text-fg/50 hover:text-fg hover:bg-fg/10 rounded p-1 transition"
              title={allActionTitle}
            >
              <SectionIcon size={11} />
            </button>
          )
        }
      />
      {expanded && (
        <>
          {allEntries.length === 0 && (
            <p className="text-fg/30 px-4 py-1.5 text-[11px]">
              {emptyWhileLoading ? 'Loading…' : emptyLabel}
            </p>
          )}
          {allEntries.length > 0 && entries.length === 0 && (
            <p className="text-fg/30 px-4 py-1.5 text-[11px]">No matches</p>
          )}
          {entries.length > 0 &&
            (panel.treeMode === 'tree' ? (
              <TreeView
                node={tree}
                level={0}
                expanded={panel.expandedFolders}
                onToggle={panel.toggleFolder}
                selectedFile={selectedFile}
                onSelect={(path) => patch({ selected: { kind: side, path } })}
                compactStats
                onContextMenuFile={(node, event) =>
                  node.file &&
                  panel.openContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    file: node.file,
                    side,
                  })
                }
                renderFileAction={(node) =>
                  node.file ? (
                    <CommitFileActionButton
                      path={node.file.path}
                      className={fileActionClass}
                      title={fileActionTitle}
                      icon={<FileActionIcon size={12} strokeWidth={2.2} />}
                      onClick={onFileAction}
                    />
                  ) : null
                }
              />
            ) : (
              entries
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((file) => (
                  <TreeView
                    key={`${side}:${file.path}`}
                    node={flatFileNode(file)}
                    level={0}
                    expanded={panel.expandedFolders}
                    onToggle={panel.toggleFolder}
                    selectedFile={selectedFile}
                    onSelect={(path) => patch({ selected: { kind: side, path } })}
                    onContextMenuFile={(node, event) =>
                      node.file &&
                      panel.openContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        file: node.file,
                        side,
                      })
                    }
                    compactStats
                    renderFileAction={(node) =>
                      node.file ? (
                        <CommitFileActionButton
                          path={node.file.path}
                          className={fileActionClass}
                          title={fileActionTitle}
                          icon={<FileActionIcon size={12} strokeWidth={2.2} />}
                          onClick={onFileAction}
                        />
                      ) : null
                    }
                  />
                ))
            ))}
        </>
      )}
    </>
  );
}

function flatFileNode(file: FileEntry): TreeNode {
  return {
    name: file.path,
    fullPath: file.path,
    type: 'file',
    children: [],
    file,
    additions: file.additions,
    deletions: file.deletions,
    fileCount: 1,
    mixedStatus: false,
    status: file.status,
  };
}
