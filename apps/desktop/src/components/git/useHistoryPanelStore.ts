import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { collectFolderPaths, type TreeNode } from '@/lib/gitDiff';
import type { CommitSummary, DiffSummary } from '@/types';

export type BranchFilter = '__head__' | '__all__' | string;

interface HistoryPanelState {
  commits: CommitSummary[];
  branches: string[];
  branchFilter: BranchFilter;
  loading: boolean;
  selectedCommit: CommitSummary | null;
  commitDiff: DiffSummary | null;
  commitDiffLoading: boolean;
  selectedFile: string | null;
  fileDiff: string | null;
  fileLoading: boolean;
  expandedFolders: Set<string>;
  commitSearch: string;
}

type HistoryPanelPatch =
  | Partial<HistoryPanelState>
  | ((state: HistoryPanelStore) => Partial<HistoryPanelState>);

interface HistoryPanelActions {
  patch: (patch: HistoryPanelPatch) => void;
  expandTree: (tree: TreeNode) => void;
  toggleFolder: (path: string) => void;
}

export type HistoryPanelStore = HistoryPanelState & HistoryPanelActions;
export type HistoryPanelStoreApi = StoreApi<HistoryPanelStore>;

function foldersFromTree(tree: TreeNode): Set<string> {
  const folders = new Set<string>();
  collectFolderPaths(tree, folders);
  return folders;
}

export function createHistoryPanelStore(): HistoryPanelStoreApi {
  return createStore<HistoryPanelStore>((set) => ({
    commits: [],
    branches: [],
    branchFilter: '__head__',
    loading: true,
    selectedCommit: null,
    commitDiff: null,
    commitDiffLoading: false,
    selectedFile: null,
    fileDiff: null,
    fileLoading: false,
    expandedFolders: new Set(),
    commitSearch: '',

    patch: (patch) => set((state) => (typeof patch === 'function' ? patch(state) : patch)),
    expandTree: (tree) => set({ expandedFolders: foldersFromTree(tree) }),
    toggleFolder: (path) =>
      set((state) => {
        const expandedFolders = new Set(state.expandedFolders);
        if (expandedFolders.has(path)) expandedFolders.delete(path);
        else expandedFolders.add(path);
        return { expandedFolders };
      }),
  }));
}

export function useHistoryPanelStoreRef(): HistoryPanelStoreApi {
  const storeRef = useRef<HistoryPanelStoreApi>();
  if (!storeRef.current) {
    storeRef.current = createHistoryPanelStore();
  }
  return storeRef.current;
}

export function useHistoryPanelStore<T>(
  store: HistoryPanelStoreApi,
  selector: (state: HistoryPanelStore) => T,
): T {
  return useStore(store, selector);
}
