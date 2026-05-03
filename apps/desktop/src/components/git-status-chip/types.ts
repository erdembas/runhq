import type { CommitSummary, GitStatus, ServiceId } from '@/types';

export const POLL_MS = 15_000;
export const POPOVER_WIDTH = 440;
export const RECENT_COMMIT_LIMIT = 5;

export type BusyOp =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'stash'
  | 'pop'
  | 'sync'
  | 'create'
  | 'undo'
  | 'amend'
  | { checkout: string }
  | { delete: string };

export type ConfirmState =
  | null
  | { kind: 'undo' }
  | { kind: 'amend'; message: string; pushed: boolean }
  | { kind: 'dirty-checkout'; target: string; dirtyCount: number }
  | { kind: 'delete-branch'; name: string; force: boolean };

export type BranchTabKind = 'local' | 'remote';

export interface GitPopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
}

export type GitActionHandler = () => void;

export interface GitActionCallbacks {
  onSync: GitActionHandler;
  onFetch: GitActionHandler;
  onPull: GitActionHandler;
  onPush: GitActionHandler;
  onStash: GitActionHandler;
  onPop: GitActionHandler;
  onOpenSource: GitActionHandler;
}

export interface BranchSectionState {
  branches: string[] | null;
  remoteBranches: string[] | null;
  filteredBranches: string[] | null;
  branchTab: BranchTabKind;
  branchSearch: string;
  creating: boolean;
  newBranch: string;
}

export interface CommitSectionState {
  recentCommits: CommitSummary[] | null;
  recentExpanded: boolean;
}

export type GitStatusValue = GitStatus;
export type GitServiceId = ServiceId;
