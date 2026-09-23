import * as i18n from '@runhq/cockpit-ui/i18n';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpToLine,
  Download,
  FileEdit,
  RefreshCcw,
} from 'lucide-react';
import { ActionButton } from './ActionButton';
import type { BusyOp, GitActionCallbacks } from './types';
import type { GitStatus } from '@/types';

interface GitActionGridProps {
  git: GitStatus;
  busy: BusyOp | null;
  actions: GitActionCallbacks;
}

export function GitActionGrid({ git, busy, actions }: GitActionGridProps) {
  i18n.useLocale();
  const { upstream, ahead, behind, is_dirty, dirty_count } = git;
  const hasUpstream = !!upstream;

  return (
    <>
      <div className="mt-3 grid grid-cols-4 gap-1">
        <ActionButton
          disabled={busy !== null || !hasUpstream}
          loading={busy === 'sync'}
          onClick={actions.onSync}
          icon={<RefreshCcw className="h-3 w-3" />}
          label={i18n.t('Sync')}
          title={
            !hasUpstream
              ? i18n.t('No upstream — set one first')
              : i18n.t('Fetch, then pull --ff-only if behind')
          }
        />
        <ActionButton
          disabled={busy !== null}
          loading={busy === 'fetch'}
          onClick={actions.onFetch}
          icon={<Download className="h-3 w-3" />}
          label={i18n.t('Fetch')}
          title={i18n.t('git fetch --all --prune')}
        />
        <ActionButton
          disabled={busy !== null || !hasUpstream || behind === 0}
          loading={busy === 'pull'}
          onClick={actions.onPull}
          icon={<ArrowDownToLine className="h-3 w-3" />}
          label={i18n.t('Pull')}
          badge={behind > 0 ? String(behind) : undefined}
          title={
            !hasUpstream
              ? i18n.t('No upstream — nothing to pull')
              : behind === 0
                ? i18n.t('Already up to date')
                : i18n.t('git pull --ff-only ({behind} behind)', { behind: behind })
          }
        />
        <ActionButton
          disabled={busy !== null || !hasUpstream || ahead === 0}
          loading={busy === 'push'}
          onClick={actions.onPush}
          icon={<ArrowUpToLine className="h-3 w-3" />}
          label={i18n.t('Push')}
          badge={ahead > 0 ? String(ahead) : undefined}
          title={
            !hasUpstream
              ? i18n.t('No upstream — set one first')
              : ahead === 0
                ? i18n.t('Nothing to push')
                : i18n.t('git push ({ahead} ahead)', { ahead: ahead })
          }
        />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <ActionButton
          disabled={busy !== null || !is_dirty}
          loading={busy === 'stash'}
          onClick={actions.onStash}
          icon={<Archive className="h-3 w-3" />}
          label={i18n.t('Stash')}
          title={
            !is_dirty ? i18n.t('Nothing to stash') : i18n.t('git stash push --include-untracked')
          }
        />
        <ActionButton
          disabled={busy !== null}
          loading={busy === 'pop'}
          onClick={actions.onPop}
          icon={<ArchiveRestore className="h-3 w-3" />}
          label={i18n.t('Pop')}
          title={i18n.t('git stash pop — reapply the most recent stash')}
        />
        <ActionButton
          disabled={false}
          loading={false}
          onClick={actions.onOpenSource}
          icon={<FileEdit className="h-3 w-3" />}
          label={is_dirty ? i18n.t('Changes') : i18n.t('History')}
          badge={is_dirty ? String(dirty_count) : undefined}
          title={
            is_dirty
              ? i18n.t('Review {dirty_count} uncommitted change{plural2}', {
                  dirty_count: dirty_count,
                  plural2: dirty_count === 1 ? '' : 's',
                })
              : i18n.t('Open commit history, branches & graph')
          }
        />
      </div>
    </>
  );
}
