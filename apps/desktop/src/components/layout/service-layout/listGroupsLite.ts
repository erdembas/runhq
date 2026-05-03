import type { LayoutNode } from '../layoutModel';

export function listGroupsLite(node: LayoutNode): string[] {
  if (node.type === 'group') return [node.id];
  return [...listGroupsLite(node.children[0]), ...listGroupsLite(node.children[1])];
}
