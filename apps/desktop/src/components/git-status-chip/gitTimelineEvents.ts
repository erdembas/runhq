import * as i18n from '@runhq/cockpit-ui/i18n/core';
import type { MutableRefObject } from 'react';
import type { GitStatus, TimelineEventType } from '@/types';

export function detectAndRecordGitEvents(
  prev: GitStatus,
  latest: GitStatus,
  suppressBranchSwitchRef: MutableRefObject<string | null>,
  record: (type: TimelineEventType, description: string) => void,
): void {
  if (latest.dirty_count > (prev.dirty_count ?? 0)) {
    record(
      'file_changed',
      i18n.t('{value1} uncommitted change(s)', { value1: latest.dirty_count }),
    );
  }

  const branchChanged = latest.branch !== prev.branch;
  if (branchChanged) {
    if (suppressBranchSwitchRef.current === latest.branch) {
      suppressBranchSwitchRef.current = null;
    } else if (latest.branch) {
      record('git_checkout', i18n.t('Checked out {value1}', { value1: latest.branch }));
    }
    return;
  }

  const pulled = prev.behind > 0 && latest.behind < prev.behind;
  if (pulled) {
    const delta = prev.behind - latest.behind;
    record(
      'git_pull',
      i18n.t('Pulled {delta} commit{plural2}', { delta: delta, plural2: delta === 1 ? '' : 's' }),
    );
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
      record('git_commit', i18n.t('Reverted last commit'));
    } else {
      record('git_commit', i18n.t('Amended: {subject}', { subject: subject }));
    }
    return;
  }

  if (aheadDelta < 0 && latest.behind === prev.behind && !hashChanged) {
    const delta = prev.ahead - latest.ahead;
    record(
      'git_push',
      i18n.t('Pushed {delta} commit{plural2}', { delta: delta, plural2: delta === 1 ? '' : 's' }),
    );
  }
}
