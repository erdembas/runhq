import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AiProvider, DiffSummary, GitStatus } from '@/types';
import type { FileEntry, TreeNode } from '@/lib/gitDiff';
import { collectFolderPaths } from '@/lib/gitDiff';

export type SelectedSource = { kind: 'staged' | 'unstaged'; path: string } | null;
export type CommitTreeMode = 'tree' | 'list';
export type CommitPanelSide = 'staged' | 'unstaged';

interface CommitContextMenu {
  x: number;
  y: number;
  file: FileEntry;
  side: CommitPanelSide;
}

interface CommitGenerationMeta {
  provider: string;
  model: string | null;
}

interface CommitPanelState {
  unstaged: DiffSummary | null;
  staged: DiffSummary | null;
  gitStatus: GitStatus | null;
  loading: boolean;
  message: string;
  amend: boolean;
  committing: boolean;
  pushing: boolean;
  generating: boolean;
  generationMeta: CommitGenerationMeta | null;
  error: string | null;
  selected: SelectedSource;
  fileDiff: string | null;
  fileLoading: boolean;
  expandedFolders: Set<string>;
  showStaged: boolean;
  showChanges: boolean;
  fileSearch: string;
  treeMode: CommitTreeMode;
  ctxMenu: CommitContextMenu | null;
  discardConfirm: { file: FileEntry } | null;
  providers: AiProvider[] | null;
  pickerOpen: boolean;
}

type CommitPanelPatch =
  | Partial<CommitPanelState>
  | ((state: CommitPanelStore) => Partial<CommitPanelState>);

interface CommitPanelActions {
  patch: (patch: CommitPanelPatch) => void;
  expandTrees: (trees: TreeNode[]) => void;
  expandAll: (trees: TreeNode[]) => void;
  collapseAll: () => void;
  toggleFolder: (path: string) => void;
  toggleShowStaged: () => void;
  toggleShowChanges: () => void;
  toggleTreeMode: () => void;
  openContextMenu: (menu: CommitContextMenu) => void;
  closeContextMenu: () => void;
}

export type CommitPanelStore = CommitPanelState & CommitPanelActions;
export type CommitPanelStoreApi = StoreApi<CommitPanelStore>;

function foldersFromTrees(trees: TreeNode[]): Set<string> {
  const folders = new Set<string>();
  for (const tree of trees) collectFolderPaths(tree, folders);
  return folders;
}

export function createCommitPanelStore(): CommitPanelStoreApi {
  return createStore<CommitPanelStore>((set) => ({
    unstaged: null,
    staged: null,
    gitStatus: null,
    loading: true,
    message: '',
    amend: false,
    committing: false,
    pushing: false,
    generating: false,
    generationMeta: null,
    error: null,
    selected: null,
    fileDiff: null,
    fileLoading: false,
    expandedFolders: new Set(),
    showStaged: true,
    showChanges: true,
    fileSearch: '',
    treeMode: 'tree',
    ctxMenu: null,
    discardConfirm: null,
    providers: null,
    pickerOpen: false,

    patch: (patch) => set((state) => (typeof patch === 'function' ? patch(state) : patch)),
    expandTrees: (trees) => set({ expandedFolders: foldersFromTrees(trees) }),
    expandAll: (trees) => set({ expandedFolders: foldersFromTrees(trees) }),
    collapseAll: () => set({ expandedFolders: new Set() }),
    toggleFolder: (path) =>
      set((state) => {
        const expandedFolders = new Set(state.expandedFolders);
        if (expandedFolders.has(path)) expandedFolders.delete(path);
        else expandedFolders.add(path);
        return { expandedFolders };
      }),
    toggleShowStaged: () => set((state) => ({ showStaged: !state.showStaged })),
    toggleShowChanges: () => set((state) => ({ showChanges: !state.showChanges })),
    toggleTreeMode: () =>
      set((state) => ({ treeMode: state.treeMode === 'tree' ? 'list' : 'tree' })),
    openContextMenu: (ctxMenu) => set({ ctxMenu }),
    closeContextMenu: () => set({ ctxMenu: null }),
  }));
}

export function useCommitPanelStoreRef(): CommitPanelStoreApi {
  const storeRef = useRef<CommitPanelStoreApi>();
  if (!storeRef.current) {
    storeRef.current = createCommitPanelStore();
  }
  return storeRef.current;
}

export function useCommitPanelStore<T>(
  store: CommitPanelStoreApi,
  selector: (state: CommitPanelStore) => T,
): T {
  return useStore(store, selector);
}
