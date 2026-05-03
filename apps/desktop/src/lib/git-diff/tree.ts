import type { FileDiff, FileDiffStatus } from '@/types';

export type FileEntry = FileDiff & { section: string };

export type TreeNode = {
  name: string;
  fullPath: string;
  type: 'file' | 'folder';
  children: TreeNode[];
  file?: FileEntry;
  additions: number;
  deletions: number;
  fileCount: number;
  mixedStatus: boolean;
  status?: FileDiffStatus;
};

export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = {
    name: '',
    fullPath: '',
    type: 'folder',
    children: [],
    additions: 0,
    deletions: 0,
    fileCount: 0,
    mixedStatus: false,
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let node = root;
    updateFolderStats(node, file);
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const name = parts[i] ?? '';
      const fullPath = parts.slice(0, i + 1).join('/');
      const nextType: 'file' | 'folder' = isLast ? 'file' : 'folder';
      let child = node.children.find((c) => c.name === name && c.type === nextType);
      if (!child) {
        child = createNode(name, fullPath, nextType, isLast ? file : undefined);
        node.children.push(child);
      }
      updateFolderStats(child, file);
      node = child;
    }
  }

  compactTree(root, root);
  return root;
}

export function collectFolderPaths(node: TreeNode, set: Set<string>): void {
  if (node.type === 'folder') {
    if (node.fullPath) set.add(node.fullPath);
    for (const child of node.children) collectFolderPaths(child, set);
  }
}

function createNode(
  name: string,
  fullPath: string,
  type: 'file' | 'folder',
  file?: FileEntry,
): TreeNode {
  return {
    name,
    fullPath,
    type,
    children: [],
    file,
    additions: 0,
    deletions: 0,
    fileCount: 0,
    mixedStatus: false,
    status: file?.status,
  };
}

function updateFolderStats(node: TreeNode, file: FileEntry): void {
  node.additions += file.additions;
  node.deletions += file.deletions;
  node.fileCount += 1;
  if (node.type !== 'folder') return;
  if (node.fileCount === 1) {
    node.status = file.status;
  } else if (node.status !== file.status) {
    node.mixedStatus = true;
    node.status = undefined;
  }
}

function compactTree(node: TreeNode, root: TreeNode): void {
  if (node.type !== 'folder') return;
  for (const child of node.children) compactTree(child, root);
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  if (node === root) return;
  while (node.children.length === 1) {
    const only = node.children[0];
    if (!only || only.type !== 'folder') break;
    node.name = `${node.name}/${only.name}`;
    node.fullPath = only.fullPath;
    node.children = only.children;
  }
}
