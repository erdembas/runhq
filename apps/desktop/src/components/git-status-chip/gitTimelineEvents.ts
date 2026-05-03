import type { MutableRefObject } from 'react';
import type { GitStatus, TimelineEventType } from '@/types';

export function detectAndRecordGitEvents(
  prev: GitStatus,
  latest: GitStatus,
  suppressBranchSwitchRef: MutableRefObject<string | null>,
  record: (type: TimelineEventType, description: string) => void,
): void {
  if (latest.dirty_count > (prev.dirty_count ?? 0)) {
    record('file_changed', `${latest.dirty_count} uncommitted change(s)`);
  }

  const branchChanged = latest.branch !== prev.branch;
  if (branchChanged) {
    if (suppressBranchSwitchRef.current === latest.branch) {
      suppressBranchSwitchRef.current = null;
    } else if (latest.branch) {
      record('git_checkout', `Checked out ${latest.branch}`);
    }
    return;
  }

  const pulled = prev.behind > 0 && latest.behind < prev.behind;
  if (pulled) {
    const delta = prev.behind - latest.behind;
    record('git_pull', `Pulled ${delta} commit${delta === 1 ? '' : 's'}`);
  }

  const prevHash = prev.last_commit?.hash_short ?? null;
  const latestHash = latest.last_commit?.hash_short ?? null;
  const hashChanged = !!latestHash && prevHash !== latestHash;
  const aheadDelta = latest.ahead - prev.ahead;

  if (hashChanged && !pulled) {
    const subject = latest.last_commit?.subject ?? '(no subject)';
    if (aheadDelta > 0) {
      record('git_commit', subject);
    } else if (aheadDelta < 0) {
      record('git_commit', 'Reverted last commit');
    } else {
      record('git_commit', `Amended: ${subject}`);
    }
    return;
  }

  if (aheadDelta < 0 && latest.behind === prev.behind && !hashChanged) {
    const delta = prev.ahead - latest.ahead;
    record('git_push', `Pushed ${delta} commit${delta === 1 ? '' : 's'}`);
  }
}
