import type { ReactNode } from 'react';
import { TreeView } from '@/components/git/shared';
import { buildTree } from '@/lib/gitDiff';
import type { Selection } from './types';

interface StagingBlockProps {
  label: string;
  hintIcon: ReactNode;
  count: number;
  tree: ReturnType<typeof buildTree>;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  selection: Selection | null;
  serviceId: string;
  source: 'unstaged' | 'staged';
  onSelect: (source: 'unstaged' | 'staged', path: string) => void;
}

export function StagingBlock({
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
}: StagingBlockProps) {
  const selectedFile =
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
        selectedFile={selectedFile}
        onSelect={(path) => onSelect(source, path)}
      />
    </div>
  );
}
