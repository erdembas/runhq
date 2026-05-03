import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { statusColor, type TreeNode } from '@/lib/gitDiff';

interface FolderRowProps {
  node: TreeNode;
  level: number;
  expanded: boolean;
  onToggle: () => void;
}

export function FolderRow({ node, level, expanded, onToggle }: FolderRowProps) {
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const folderColor =
    node.mixedStatus || !node.status ? 'text-sky-400/70' : statusColor[node.status];

  return (
    <button
      onClick={onToggle}
      className="text-fg/80 hover:bg-fg/6 group flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] transition-colors"
      style={{ paddingLeft: 4 + level * 14 }}
    >
      <Chevron size={12} className="text-fg/40 shrink-0" strokeWidth={2} />
      <FolderIcon size={13} className={cn('shrink-0', folderColor)} strokeWidth={1.6} />
      <span className="truncate">{node.name}</span>
      <span className="text-fg/30 ml-auto shrink-0 text-[10px] tabular-nums">{node.fileCount}</span>
    </button>
  );
}
