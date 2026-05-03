/**
 * VS Code-style recursive split layout primitives for the per-service
 * panel.
 *
 * The layout is a binary tree of `LayoutNode`s. Leaves are
 * `GroupNode`s (a tab strip + an active body); internal nodes are
 * `SplitNode`s (a horizontal/vertical 2-way divider with two child
 * subtrees and a size ratio between them).
 *
 * Tabs are referenced by id from a flat `tabs` table on the root
 * state — that way moving a tab between groups is a pointer swap on
 * the tree rather than copying tab metadata around. The tabs table
 * is the single source of truth for "what tabs exist"; the tree is
 * the source of truth for "where they live".
 *
 * Tab kinds:
 *   - `logs` / `docs` / `notes`: singletons-per-service. Always
 *     present (or, in `docs`'s case, gated on actual project
 *     discovery — see `LayoutState.includeDocs`). Closing them is
 *     suppressed in the UI.
 *   - `terminal`: dynamic. The user can spawn as many as they want
 *     via the "+" affordance on a tab strip. Closing kills the PTY
 *     (the underlying `<TerminalPane>` unmounts and its cleanup
 *     fires `terminal_destroy`).
 */

export type TabKind = 'logs' | 'docs' | 'notes' | 'terminal';

export interface Tab {
  id: string;
  kind: TabKind;
  /** Display title in the tab strip. Editable for `terminal` kind. */
  title: string;
}

/** A leaf in the layout tree — one tab strip, one active body. */
export interface GroupNode {
  type: 'group';
  /** Stable id used by drag/drop targets and `react-resizable-panels` keys. */
  id: string;
  /** Ordered list of tab ids that live in this group. */
  tabs: string[];
  /** Currently visible tab in this group, or `null` for an empty group. */
  activeTab: string | null;
}

/** An internal node — a horizontal or vertical 2-way split. */
export interface SplitNode {
  type: 'split';
  id: string;
  /**
   * Direction of the divider:
   *   - `horizontal`: children sit side-by-side, divider runs vertically
   *   - `vertical`: children stack top/bottom, divider runs horizontally
   *
   * Naming follows `react-resizable-panels`'s `direction` axis (the
   * direction the children flow), which is the inverse of the
   * divider's geometry — easy to mix up, see the JSDoc on every
   * action that uses this.
   */
  orientation: 'horizontal' | 'vertical';
  children: [LayoutNode, LayoutNode];
  /** Percentage sizes for the two children. Must sum to 100. */
  sizes: [number, number];
}

export type LayoutNode = GroupNode | SplitNode;

/** Edges of a pane the user can drop a tab onto to create a split. */
export type SplitEdge = 'top' | 'right' | 'bottom' | 'left';

export interface LayoutState {
  /** Recursive tree root. */
  root: LayoutNode;
  /**
   * Flat tab table. The tree references tabs by id; metadata
   * (kind, title) lives here so we don't copy strings around when
   * a tab moves between groups.
   */
  tabs: Record<string, Tab>;
  /**
   * Monotonic counter for fresh terminal labels. Increments on
   * `add-terminal`; never decreases (closing "Terminal 2" doesn't
   * recycle the number — the user reading "Terminal 7" never
   * watches it silently change to "Terminal 3").
   */
  nextTermIdx: number;
  /**
   * Whether the project has discoverable docs. Computed
   * asynchronously by the parent (`discoverProjectDocs` IPC) and
   * pushed in via the `set-include-docs` action. When false we
   * filter the docs tab out of any group it lives in (instead of
   * deleting it from the tree, so toggling back doesn't lose
   * placement).
   */
  includeDocs: boolean;
}

// ---- Defaults --------------------------------------------------------------

/** First-launch layout for a service that has no persisted state. */
export function defaultLayoutState(): LayoutState {
  const firstTermId = 'terminal-1';
  return {
    root: {
      type: 'group',
      id: 'root',
      tabs: ['logs', 'docs', 'notes', firstTermId],
      activeTab: 'logs',
    },
    tabs: {
      logs: { id: 'logs', kind: 'logs', title: 'Logs' },
      docs: { id: 'docs', kind: 'docs', title: 'Docs' },
      notes: { id: 'notes', kind: 'notes', title: 'Notes' },
      [firstTermId]: { id: firstTermId, kind: 'terminal', title: 'Terminal 1' },
    },
    nextTermIdx: 2,
    includeDocs: false,
  };
}

// ---- Actions ---------------------------------------------------------------

export type LayoutAction =
  /** Replace the entire state (used on hydrate-from-localStorage). */
  | { type: 'init'; state: LayoutState }
  /** User clicked a tab; bring it to front in its group. */
  | { type: 'activate-tab'; groupId: string; tabId: string }
  /** "+" button or imperative spawn from outside (e.g. docs "Run"). */
  | { type: 'add-terminal'; groupId: string }
  /** Inline rename in the tab strip. Trim/empty guard runs in reducer. */
  | { type: 'rename-tab'; tabId: string; title: string }
  /**
   * X button on a tab. Singletons (logs/docs/notes) are no-op so the
   * UI doesn't have to know which kinds are closeable; reducer
   * enforces. Removing the last tab in a group collapses the group
   * out of any parent split.
   */
  | { type: 'close-tab'; tabId: string }
  /** Drag-drop: move within a group (reorder) or to another group. */
  | {
      type: 'move-tab';
      tabId: string;
      targetGroupId: string;
      /** Insert position; -1 / undefined = append to end. */
      insertIndex?: number;
    }
  /**
   * Drag-drop onto a pane edge: split the target group, place the
   * dragged tab into the new sibling group on the chosen side.
   */
  | {
      type: 'split-tab';
      tabId: string;
      targetGroupId: string;
      edge: SplitEdge;
    }
  /** User dragged the panel divider; persist the new ratio. */
  | { type: 'resize-split'; splitId: string; sizes: [number, number] }
  /** Async docs-discovery result. */
  | { type: 'set-include-docs'; includeDocs: boolean }
  /** "Reset layout" header button. */
  | { type: 'reset' };

// ---- Reducer ---------------------------------------------------------------

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'init':
      return action.state;

    case 'reset':
      return { ...defaultLayoutState(), includeDocs: state.includeDocs };

    case 'set-include-docs':
      if (state.includeDocs === action.includeDocs) return state;
      return { ...state, includeDocs: action.includeDocs };

    case 'activate-tab': {
      const root = updateNode(state.root, action.groupId, (n) => {
        if (n.type !== 'group') return n;
        if (!n.tabs.includes(action.tabId)) return n;
        if (n.activeTab === action.tabId) return n;
        return { ...n, activeTab: action.tabId };
      });
      return root === state.root ? state : { ...state, root };
    }

    case 'add-terminal': {
      const idx = state.nextTermIdx;
      const newId = `terminal-${idx}`;
      const newTab: Tab = {
        id: newId,
        kind: 'terminal',
        title: `Terminal ${idx}`,
      };
      const root = updateNode(state.root, action.groupId, (n) => {
        if (n.type !== 'group') return n;
        return { ...n, tabs: [...n.tabs, newId], activeTab: newId };
      });
      return {
        ...state,
        root,
        tabs: { ...state.tabs, [newId]: newTab },
        nextTermIdx: idx + 1,
      };
    }

    case 'rename-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab || tab.kind !== 'terminal') return state;
      const trimmed = action.title.trim().slice(0, 40);
      if (!trimmed || trimmed === tab.title) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: { ...tab, title: trimmed } },
      };
    }

    case 'close-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      // Singletons stay open; X button shouldn't render for them
      // anyway, but defence in depth keeps a future drag-drop
      // accident from wiping the LOGS tab.
      if (tab.kind !== 'terminal') return state;

      // Remove tab id from whichever group holds it, fix its
      // active selection, then collapse empty groups out of any
      // surrounding split.
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = collapseEmptyGroups(root1);
      const { [action.tabId]: _removed, ...remainingTabs } = state.tabs;
      void _removed;
      return { ...state, root: root2, tabs: remainingTabs };
    }

    case 'move-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = insertTabIntoGroup(
        root1,
        action.targetGroupId,
        action.tabId,
        action.insertIndex,
      );
      const root3 = collapseEmptyGroups(root2);
      return { ...state, root: root3 };
    }

    case 'split-tab': {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      // Reject split-onto-self when the target group has only this
      // one tab — splitting it would leave both new groups empty
      // (one with the moved tab, the source going to zero) and
      // collapse instantly. No-op rather than visually stutter.
      const targetGroup = findGroup(state.root, action.targetGroupId);
      if (targetGroup && targetGroup.tabs.length === 1 && targetGroup.tabs[0] === action.tabId) {
        return state;
      }
      const root1 = removeTabFromTree(state.root, action.tabId);
      const root2 = splitTreeAroundGroup(root1, action.targetGroupId, action.tabId, action.edge);
      const root3 = collapseEmptyGroups(root2);
      return { ...state, root: root3 };
    }

    case 'resize-split': {
      const root = updateNode(state.root, action.splitId, (n) => {
        if (n.type !== 'split') return n;
        return { ...n, sizes: action.sizes };
      });
      return root === state.root ? state : { ...state, root };
    }

    default:
      return state;
  }
}

// ---- Tree helpers ----------------------------------------------------------

/**
 * Walk the tree and apply `mut` to the node with matching id.
 * Returns the same root reference if nothing changed (lets callers
 * skip re-rendering on no-op actions). Otherwise returns a fresh
 * tree with the matched node replaced.
 */
function updateNode(node: LayoutNode, id: string, mut: (n: LayoutNode) => LayoutNode): LayoutNode {
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

function findGroup(node: LayoutNode, id: string): GroupNode | null {
  if (node.type === 'group') return node.id === id ? node : null;
  return findGroup(node.children[0], id) ?? findGroup(node.children[1], id);
}

/** Remove `tabId` from whichever group holds it. */
function removeTabFromTree(node: LayoutNode, tabId: string): LayoutNode {
  if (node.type === 'group') {
    if (!node.tabs.includes(tabId)) return node;
    const tabs = node.tabs.filter((t) => t !== tabId);
    let activeTab = node.activeTab;
    if (activeTab === tabId) {
      // Promote the tab that *was* sitting just before the removed
      // one in the strip. Same heuristic VS Code uses; keeps the
      // user's eye anchored on the remaining row instead of
      // snapping to position 0.
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

function insertTabIntoGroup(
  node: LayoutNode,
  groupId: string,
  tabId: string,
  insertIndex?: number,
): LayoutNode {
  return updateNode(node, groupId, (n) => {
    if (n.type !== 'group') return n;
    const at = insertIndex == null || insertIndex < 0 ? n.tabs.length : insertIndex;
    const tabs = [...n.tabs.slice(0, at), tabId, ...n.tabs.slice(at)];
    return { ...n, tabs, activeTab: tabId };
  });
}

/**
 * Replace `targetGroupId` with a new split node. The dragged tab
 * lands in a fresh group on the chosen edge; the original group
 * stays on the opposite edge with its remaining tabs.
 */
function splitTreeAroundGroup(
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

/**
 * Walk the tree post-order; if a split has an empty group on either
 * side, replace the split with the surviving sibling. Repeat until
 * stable so deeply-nested splits collapse cleanly when their grand-
 * children empty out.
 */
function collapseEmptyGroups(node: LayoutNode): LayoutNode {
  if (node.type === 'group') return node;
  const a0 = collapseEmptyGroups(node.children[0]);
  const b0 = collapseEmptyGroups(node.children[1]);
  const a = a0;
  const b = b0;
  const aEmpty = a.type === 'group' && a.tabs.length === 0;
  const bEmpty = b.type === 'group' && b.tabs.length === 0;
  if (aEmpty && bEmpty) {
    // Both kids are empty groups — collapse to a single empty group
    // so the root never disappears entirely. The UI's empty state
    // will offer to spawn a fresh terminal.
    return { type: 'group', id: a.id, tabs: [], activeTab: null };
  }
  if (aEmpty) return b;
  if (bEmpty) return a;
  if (a === node.children[0] && b === node.children[1]) return node;
  return { ...node, children: [a, b] };
}

// ---- Id generation ---------------------------------------------------------

let _idCounter = 0;
function makeId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter}`;
}
export function makeGroupId(): string {
  return makeId('g');
}
export function makeSplitId(): string {
  return makeId('s');
}

// ---- Selectors -------------------------------------------------------------

/** Flatten the tree to the list of group nodes (left-to-right, depth-first). */
export function listGroups(root: LayoutNode): GroupNode[] {
  const out: GroupNode[] = [];
  walk(root, (n) => {
    if (n.type === 'group') out.push(n);
  });
  return out;
}

function walk(node: LayoutNode, visit: (n: LayoutNode) => void): void {
  visit(node);
  if (node.type === 'split') {
    walk(node.children[0], visit);
    walk(node.children[1], visit);
  }
}

/** Find the group that currently holds `tabId`, or null. */
export function findGroupByTab(root: LayoutNode, tabId: string): GroupNode | null {
  for (const g of listGroups(root)) {
    if (g.tabs.includes(tabId)) return g;
  }
  return null;
}

/**
 * "Best" group to land a freshly-spawned terminal in when the
 * caller doesn't specify one (e.g. quick-action deep link). We
 * prefer:
 *   1. A group that already contains a terminal (keeps related
 *      shells colocated).
 *   2. The first group in the tree (leftmost / topmost), so a
 *      brand-new layout's single group is always the target.
 */
export function preferredTerminalGroup(state: LayoutState): GroupNode | null {
  const groups = listGroups(state.root);
  if (groups.length === 0) return null;
  const withTerminal = groups.find((g) => g.tabs.some((id) => state.tabs[id]?.kind === 'terminal'));
  return withTerminal ?? groups[0]!;
}
