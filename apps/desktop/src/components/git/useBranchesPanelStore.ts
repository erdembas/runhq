import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { collectFolderPaths, type TreeNode } from '@/lib/gitDiff';
import type { DiffSummary } from '@/types';

interface BranchesPanelState {
  branches: string[];
  baseBranch: string;
  headBranch: string;
  diff: DiffSummary | null;
  loading: boolean;
  selectedFile: string | null;
  fileDiff: string | null;
  fileLoading: boolean;
  expandedFolders: Set<string>;
  fileSearch: string;
}

type BranchesPanelPatch =
  | Partial<BranchesPanelState>
  | ((state: BranchesPanelStore) => Partial<BranchesPanelState>);

interface BranchesPanelActions {
  patch: (patch: BranchesPanelPatch) => void;
  expandTree: (tree: TreeNode) => void;
  toggleFolder: (path: string) => void;
}

export type BranchesPanelStore = BranchesPanelState & BranchesPanelActions;
export type BranchesPanelStoreApi = StoreApi<BranchesPanelStore>;

function foldersFromTree(tree: TreeNode): Set<string> {
  const folders = new Set<string>();
  collectFolderPaths(tree, folders);
  return folders;
}

export function createBranchesPanelStore(): BranchesPanelStoreApi {
  return createStore<BranchesPanelStore>((set) => ({
    branches: [],
    baseBranch: '',
    headBranch: '',
    diff: null,
    loading: false,
    selectedFile: null,
    fileDiff: null,
    fileLoading: false,
    expandedFolders: new Set(),
    fileSearch: '',

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

export function useBranchesPanelStoreRef(): BranchesPanelStoreApi {
  const storeRef = useRef<BranchesPanelStoreApi>();
  if (!storeRef.current) {
    storeRef.current = createBranchesPanelStore();
  }
  return storeRef.current;
}

export function useBranchesPanelStore<T>(
  store: BranchesPanelStoreApi,
  selector: (state: BranchesPanelStore) => T,
): T {
  return useStore(store, selector);
}
