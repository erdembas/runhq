import { invoke } from '@tauri-apps/api/core';
import type { CommitSummary, DiffSummary, GitStatus, ServiceId } from '@/types';

export const gitIpc = {
  gitStatus: (id: ServiceId) => invoke<GitStatus | null>('git_status', { id }),
  gitBranches: (id: ServiceId) => invoke<string[]>('git_branches', { id }),
  gitRemoteBranches: (id: ServiceId) => invoke<string[]>('git_remote_branches', { id }),
  gitCheckout: (id: ServiceId, branch: string) => invoke<void>('git_checkout', { id, branch }),
  gitCreateBranch: (id: ServiceId, name: string) => invoke<void>('git_create_branch', { id, name }),
  gitDeleteBranch: (id: ServiceId, name: string, force: boolean) =>
    invoke<void>('git_delete_branch', { id, name, force }),
  gitFetch: (id: ServiceId) => invoke<void>('git_fetch', { id }),
  gitPull: (id: ServiceId) => invoke<void>('git_pull', { id }),
  gitStash: (id: ServiceId, message?: string | null) =>
    invoke<void>('git_stash', { id, message: message ?? null }),
  gitStashPop: (id: ServiceId) => invoke<void>('git_stash_pop', { id }),
  gitUndoLastCommit: (id: ServiceId) => invoke<void>('git_undo_last_commit', { id }),
  gitAmendCommitMessage: (id: ServiceId, message: string) =>
    invoke<void>('git_amend_commit_message', { id, message }),

  gitDiff: (id: ServiceId) => invoke<DiffSummary>('git_diff', { id }),
  gitDiffStaged: (id: ServiceId) => invoke<DiffSummary>('git_diff_staged', { id }),
  gitDiffFile: (id: ServiceId, file: string, context?: number) =>
    invoke<string>('git_diff_file', { id, file, context }),
  gitDiffFileStaged: (id: ServiceId, file: string, context?: number) =>
    invoke<string>('git_diff_file_staged', { id, file, context }),
  gitDiffBranches: (id: ServiceId, base: string, head: string) =>
    invoke<DiffSummary>('git_diff_branches', { id, base, head }),
  gitDiffAllRaw: (id: ServiceId) => invoke<string>('git_diff_all_raw', { id }),
  gitDiffStagedRaw: (id: ServiceId) => invoke<string>('git_diff_staged_raw', { id }),

  gitStageFile: (id: ServiceId, path: string) => invoke<void>('git_stage_file', { id, path }),
  gitUnstageFile: (id: ServiceId, path: string) => invoke<void>('git_unstage_file', { id, path }),
  gitStageAll: (id: ServiceId) => invoke<void>('git_stage_all', { id }),
  gitUnstageAll: (id: ServiceId) => invoke<void>('git_unstage_all', { id }),
  gitDiscardFile: (id: ServiceId, path: string) => invoke<void>('git_discard_file', { id, path }),
  gitCommit: (id: ServiceId, message: string, amend = false) =>
    invoke<void>('git_commit', { id, message, amend }),
  gitPush: (id: ServiceId, forceWithLease = false) =>
    invoke<void>('git_push', { id, forceWithLease }),
  gitLog: (id: ServiceId, branch?: string | null, limit = 200) =>
    invoke<CommitSummary[]>('git_log', { id, branch: branch ?? null, limit }),
  gitShowCommit: (id: ServiceId, hash: string) =>
    invoke<DiffSummary>('git_show_commit', { id, hash }),
  gitDiffCommitFile: (id: ServiceId, hash: string, file: string, context?: number) =>
    invoke<string>('git_diff_commit_file', { id, hash, file, context }),
};
