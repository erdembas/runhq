import type { GroupNode, LayoutNode, LayoutState, SplitEdge } from './layoutTypes';

export function updateNode(
  node: LayoutNode,
  id: string,
  mut: (n: LayoutNode) => LayoutNode,
): LayoutNode {
  if (node.id === id) {
    const next = mut(node);
    return next === node ? node : next;
  }
  if (node.type === 'split') {
    const a = updateNode(node.children[0], id, mut);
    const b = updateNode(node.children[1], id, mut);
    if (a === node.children[0] && b === node.children[1]) return node;
    return { ...node, children: [a, b] };
  }
  return node;
}

export function findGroup(node: LayoutNode, id: string): GroupNode | null {
  if (node.type === 'group') return node.id === id ? node : null;
  return findGroup(node.children[0], id) ?? findGroup(node.children[1], id);
}

export function removeTabFromTree(node: LayoutNode, tabId: string): LayoutNode {
  if (node.type === 'group') {
    if (!node.tabs.includes(tabId)) return node;
    const tabs = node.tabs.filter((t) => t !== tabId);
    let activeTab = node.activeTab;
    if (activeTab === tabId) {
      const removedAt = node.tabs.indexOf(tabId);
      activeTab = tabs[Math.max(0, removedAt - 1)] ?? tabs[0] ?? null;
    }
    return { ...node, tabs, activeTab };
  }
  const a = removeTabFromTree(node.children[0], tabId);
  const b = removeTabFromTree(node.children[1], tabId);
  if (a === node.children[0] && b === node.children[1]) return node;
  return { ...node, children: [a, b] };
}

export function insertTabIntoGroup(
  node: LayoutNode,
  groupId: string,
  tabId: string,
  insertIndex?: number,
  activate = true,
): LayoutNode {
  return updateNode(node, groupId, (n) => {
    if (n.type !== 'group') return n;
    const at = insertIndex == null || insertIndex < 0 ? n.tabs.length : insertIndex;
    const tabs = [...n.tabs.slice(0, at), tabId, ...n.tabs.slice(at)];
    return { ...n, tabs, activeTab: activate || n.activeTab == null ? tabId : n.activeTab };
  });
}

export function splitTreeAroundGroup(
  node: LayoutNode,
  targetGroupId: string,
  tabId: string,
  edge: SplitEdge,
): LayoutNode {
  if (node.type === 'group' && node.id === targetGroupId) {
    const newGroup: GroupNode = {
      type: 'group',
      id: makeGroupId(),
      tabs: [tabId],
      activeTab: tabId,
    };
    const orientation: 'horizontal' | 'vertical' =
      edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
    const newGroupFirst = edge === 'left' || edge === 'top';
    const children: [LayoutNode, LayoutNode] = newGroupFirst ? [newGroup, node] : [node, newGroup];
    return {
      type: 'split',
      id: makeSplitId(),
      orientation,
      children,
      sizes: [50, 50],
    };
  }
  if (node.type === 'split') {
    const a = splitTreeAroundGroup(node.children[0], targetGroupId, tabId, edge);
    const b = splitTreeAroundGroup(node.children[1], targetGroupId, tabId, edge);
    if (a === node.children[0] && b === node.children[1]) return node;
    return { ...node, children: [a, b] };
  }
  return node;
}

export function collapseEmptyGroups(node: LayoutNode): LayoutNode {
  if (node.type === 'group') return node;
  const a = collapseEmptyGroups(node.children[0]);
  const b = collapseEmptyGroups(node.children[1]);
  const aEmpty = a.type === 'group' && a.tabs.length === 0;
  const bEmpty = b.type === 'group' && b.tabs.length === 0;
  if (aEmpty && bEmpty) {
    return { type: 'group', id: a.id, tabs: [], activeTab: null };
  }
  if (aEmpty) return b;
  if (bEmpty) return a;
  if (a === node.children[0] && b === node.children[1]) return node;
  return { ...node, children: [a, b] };
}

export function listGroups(root: LayoutNode): GroupNode[] {
  const out: GroupNode[] = [];
  walk(root, (n) => {
    if (n.type === 'group') out.push(n);
  });
  return out;
}

export function findGroupByTab(root: LayoutNode, tabId: string): GroupNode | null {
  for (const g of listGroups(root)) {
    if (g.tabs.includes(tabId)) return g;
  }
  return null;
}

export function preferredTerminalGroup(state: LayoutState): GroupNode | null {
  const groups = listGroups(state.root);
  if (groups.length === 0) return null;
  const withTerminal = groups.find((g) => g.tabs.some((id) => state.tabs[id]?.kind === 'terminal'));
  return withTerminal ?? groups[0]!;
}

function walk(node: LayoutNode, visit: (n: LayoutNode) => void): void {
  visit(node);
  if (node.type === 'split') {
    walk(node.children[0], visit);
    walk(node.children[1], visit);
  }
}

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function makeGroupId(): string {
  return makeId('g');
}

export function makeSplitId(): string {
  return makeId('s');
}
