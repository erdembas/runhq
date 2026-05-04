export type TabKind = 'logs' | 'docs' | 'notes' | 'terminal';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  commandName?: string;
}

export interface GroupNode {
  type: 'group';
  id: string;
  tabs: string[];
  activeTab: string | null;
}

export interface SplitNode {
  type: 'split';
  id: string;
  orientation: 'horizontal' | 'vertical';
  children: [LayoutNode, LayoutNode];
  sizes: [number, number];
}

export type LayoutNode = GroupNode | SplitNode;
export type SplitEdge = 'top' | 'right' | 'bottom' | 'left';

export interface LayoutState {
  root: LayoutNode;
  tabs: Record<string, Tab>;
  nextTermIdx: number;
  includeDocs: boolean;
  knownLogCommands: string[];
}

export type LayoutAction =
  | { type: 'init'; state: LayoutState }
  | { type: 'activate-tab'; groupId: string; tabId: string }
  | { type: 'add-terminal'; groupId: string }
  | { type: 'sync-command-log-tabs'; commands: string[] }
  | { type: 'open-command-log-tab'; commandName: string }
  | { type: 'rename-tab'; tabId: string; title: string }
  | { type: 'close-tab'; tabId: string }
  | {
      type: 'move-tab';
      tabId: string;
      targetGroupId: string;
      insertIndex?: number;
    }
  | {
      type: 'split-tab';
      tabId: string;
      targetGroupId: string;
      edge: SplitEdge;
    }
  | { type: 'resize-split'; splitId: string; sizes: [number, number] }
  | { type: 'set-include-docs'; includeDocs: boolean }
  | { type: 'reset'; commands?: string[] };
