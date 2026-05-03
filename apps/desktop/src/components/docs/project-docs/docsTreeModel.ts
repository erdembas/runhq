import type { ProjectDoc } from '@/types';
import type { DocsTreeNode } from './docsNavTypes';

export function buildDocsTree(docs: ProjectDoc[]): DocsTreeNode[] {
  const root: DocsTreeNode[] = [];
  const folders = new Map<string, DocsTreeNode>();

  for (const doc of docs) {
    const parts = doc.relative_path.split('/').filter(Boolean);
    let level = root;
    let prefix = '';
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      prefix = prefix ? `${prefix}/${part}` : part;
      if (isFile) {
        level.push({ key: doc.relative_path, name: part, depth: index, doc, children: [] });
        return;
      }
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { key: prefix, name: part, depth: index, doc: null, children: [] };
        folders.set(prefix, folder);
        level.push(folder);
      }
      level = folder.children;
    });
  }

  return sortNodes(root);
}

export function collectFolderKeys(nodes: DocsTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (items: DocsTreeNode[]) => {
    for (const node of items) {
      if (node.children.length === 0) continue;
      out.push(node.key);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function sortNodes(nodes: DocsTreeNode[]): DocsTreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.doc === null && b.doc !== null) return -1;
      if (a.doc !== null && b.doc === null) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    })
    .map((node) => ({ ...node, children: sortNodes(node.children) }));
}
