import { FoldVertical, List, ListTree, UnfoldVertical } from 'lucide-react';
import { GitStatusLegend } from '@/components/git/shared';
import type { CommitTreeMode } from '@/components/git/useCommitPanelStore';

interface CommitToolbarProps {
  treeMode: CommitTreeMode;
  onToggleTreeMode: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function CommitToolbar({
  treeMode,
  onToggleTreeMode,
  onExpandAll,
  onCollapseAll,
}: CommitToolbarProps) {
  const treeDisabled = treeMode !== 'tree';

  return (
    <div className="border-border flex items-center gap-1 border-b px-2 py-1">
      <button
        onClick={onToggleTreeMode}
        className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition"
        title={treeMode === 'tree' ? 'Switch to flat list' : 'Switch to tree view'}
      >
        {treeMode === 'tree' ? <ListTree size={13} /> : <List size={13} />}
      </button>
      <button
        onClick={onExpandAll}
        disabled={treeDisabled}
        className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition disabled:opacity-30"
        title="Expand all"
      >
        <UnfoldVertical size={13} />
      </button>
      <button
        onClick={onCollapseAll}
        disabled={treeDisabled}
        className="text-fg/50 hover:bg-fg/10 hover:text-fg rounded p-1 transition disabled:opacity-30"
        title="Collapse all"
      >
        <FoldVertical size={13} />
      </button>
      <span className="ml-auto" />
      <GitStatusLegend />
    </div>
  );
}
