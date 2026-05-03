import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SubNavButton } from './SubNavButton';
import type { DocsTreeNode as TreeNode } from './docsNavTypes';

interface DocsTreeNodeProps {
  node: TreeNode;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (path: string) => void;
}

export function DocsTreeNode({
  node,
  activePath,
  expanded,
  onToggle,
  onSelect,
}: DocsTreeNodeProps) {
  if (node.doc) {
    return (
      <SubNavButton
        doc={node.doc}
        active={activePath === node.doc.relative_path}
        onSelect={onSelect}
        label={node.name}
        depth={node.depth}
      />
    );
  }

  const isExpanded = expanded.has(node.key);
  return (
    <div>
      <button
        type="button"
        title={node.key}
        onClick={() => onToggle(node.key)}
        className={cn(
          'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] transition-colors',
        )}
        style={{ paddingLeft: 8 + node.depth * 14 }}
      >
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 transition-transform', isExpanded && 'rotate-90')}
        />
        {isExpanded ? (
          <FolderOpen className="text-fg-dim h-3 w-3 shrink-0" />
        ) : (
          <Folder className="text-fg-dim h-3 w-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <DocsTreeNode
              key={child.key}
              node={child}
              activePath={activePath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
