export type FileDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

export interface FileDiff {
  path: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
}

export interface DiffSummary {
  files: FileDiff[];
  total_additions: number;
  total_deletions: number;
}

export interface CommitSummary {
  hash_full: string;
  hash_short: string;
  parents: string[];
  author: string;
  email: string;
  subject: string;
  timestamp: number;
  refs: string[];
}
