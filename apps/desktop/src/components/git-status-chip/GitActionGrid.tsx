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
          label="Sync"
          title={
            !hasUpstream ? 'No upstream — set one first' : 'Fetch, then pull --ff-only if behind'
          }
        />
        <ActionButton
          disabled={busy !== null}
          loading={busy === 'fetch'}
          onClick={actions.onFetch}
          icon={<Download className="h-3 w-3" />}
          label="Fetch"
          title="git fetch --all --prune"
        />
        <ActionButton
          disabled={busy !== null || !hasUpstream || behind === 0}
          loading={busy === 'pull'}
          onClick={actions.onPull}
          icon={<ArrowDownToLine className="h-3 w-3" />}
          label="Pull"
          badge={behind > 0 ? String(behind) : undefined}
          title={
            !hasUpstream
              ? 'No upstream — nothing to pull'
              : behind === 0
                ? 'Already up to date'
                : `git pull --ff-only (${behind} behind)`
          }
        />
        <ActionButton
          disabled={busy !== null || !hasUpstream || ahead === 0}
          loading={busy === 'push'}
          onClick={actions.onPush}
          icon={<ArrowUpToLine className="h-3 w-3" />}
          label="Push"
          badge={ahead > 0 ? String(ahead) : undefined}
          title={
            !hasUpstream
              ? 'No upstream — set one first'
              : ahead === 0
                ? 'Nothing to push'
                : `git push (${ahead} ahead)`
          }
        />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <ActionButton
          disabled={busy !== null || !is_dirty}
          loading={busy === 'stash'}
          onClick={actions.onStash}
          icon={<Archive className="h-3 w-3" />}
          label="Stash"
          title={!is_dirty ? 'Nothing to stash' : 'git stash push --include-untracked'}
        />
        <ActionButton
          disabled={busy !== null}
          loading={busy === 'pop'}
          onClick={actions.onPop}
          icon={<ArchiveRestore className="h-3 w-3" />}
          label="Pop"
          title="git stash pop — reapply the most recent stash"
        />
        <ActionButton
          disabled={false}
          loading={false}
          onClick={actions.onOpenSource}
          icon={<FileEdit className="h-3 w-3" />}
          label={is_dirty ? 'Changes' : 'History'}
          badge={is_dirty ? String(dirty_count) : undefined}
          title={
            is_dirty
              ? `Review ${dirty_count} uncommitted change${dirty_count === 1 ? '' : 's'}`
              : 'Open commit history, branches & graph'
          }
        />
      </div>
    </>
  );
}
