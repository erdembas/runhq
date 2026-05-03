import type { buildTree, FileEntry } from '@/lib/gitDiff';
import type { DiffSummary, ProjectOverview } from '@/types';

export interface ServiceBucket {
  project: ProjectOverview;
  unstaged: DiffSummary | null;
  staged: DiffSummary | null;
  loading: boolean;
  error: string | null;
}

export interface Selection {
  serviceId: string;
  source: 'unstaged' | 'staged';
  path: string;
}

export interface ServiceTree {
  project: ProjectOverview;
  unstagedEntries: FileEntry[];
  stagedEntries: FileEntry[];
  unstagedTree: ReturnType<typeof buildTree>;
  stagedTree: ReturnType<typeof buildTree>;
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  loading: boolean;
  error: string | null;
}
