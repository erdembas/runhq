import type { ProjectDoc } from '@/types';

export type DocsNavMode = 'flat' | 'tree';

export interface DocsTreeNode {
  key: string;
  name: string;
  depth: number;
  doc: ProjectDoc | null;
  children: DocsTreeNode[];
}
