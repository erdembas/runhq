import type { ProjectDoc } from '@/types';
import { DocsTreeNode } from './DocsTreeNode';
import { buildDocsTree } from './docsTreeModel';

interface DocsTreeNavProps {
  docs: ProjectDoc[];
  activePath: string | null;
  expanded: Set<string>;
  onToggleFolder: (key: string) => void;
  onSelect: (path: string) => void;
}

export function DocsTreeNav({
  docs,
  activePath,
  expanded,
  onToggleFolder,
  onSelect,
}: DocsTreeNavProps) {
  const tree = buildDocsTree(docs);
  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <DocsTreeNode
          key={node.key}
          node={node}
          activePath={activePath}
          expanded={expanded}
          onToggle={onToggleFolder}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
