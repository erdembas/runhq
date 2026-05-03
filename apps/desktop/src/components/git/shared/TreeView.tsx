import type { ReactNode } from 'react';
import { FileRow } from '@/components/git/shared/FileRow';
import { FolderRow } from '@/components/git/shared/FolderRow';
import type { TreeNode } from '@/lib/gitDiff';

interface TreeViewProps {
  node: TreeNode;
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  renderFileAction?: (node: TreeNode) => ReactNode;
  compactStats?: boolean;
  onContextMenuFile?: (node: TreeNode, event: React.MouseEvent) => void;
}

export function TreeView({
  node,
  level,
  expanded,
  onToggle,
  selectedFile,
  onSelect,
  renderFileAction,
  compactStats,
  onContextMenuFile,
}: TreeViewProps) {
  if (node.type === 'file' && node.file) {
    return (
      <FileRow
        node={node}
        level={level}
        isActive={selectedFile === node.file.path}
        onSelect={() => onSelect(node.file!.path)}
        action={renderFileAction?.(node)}
        compactStats={compactStats}
        onContextMenu={
          onContextMenuFile
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenuFile(node, event);
              }
            : undefined
        }
      />
    );
  }

  const isExpanded = expanded.has(node.fullPath);
  return (
    <>
      {node.fullPath !== '' && (
        <FolderRow
          node={node}
          level={level}
          expanded={isExpanded}
          onToggle={() => onToggle(node.fullPath)}
        />
      )}
      {(node.fullPath === '' || isExpanded) &&
        node.children.map((child) => (
          <TreeView
            key={`${child.type}:${child.fullPath || child.name}`}
            node={child}
            level={node.fullPath === '' ? level : level + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedFile={selectedFile}
            onSelect={onSelect}
            renderFileAction={renderFileAction}
            compactStats={compactStats}
            onContextMenuFile={onContextMenuFile}
          />
        ))}
    </>
  );
}
