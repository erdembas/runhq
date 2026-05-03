import { ConfirmDialog, type ConfirmTone } from '@/components/ui/ConfirmDialog';
import type { ConfirmState } from './types';
import type { GitCommitInfo } from '@/types';

interface GitConfirmDialogsProps {
  confirm: ConfirmState;
  lastCommit: GitCommitInfo | null;
  onCancel: () => void;
  onUndo: () => void;
  onAmend: (message: string) => void;
  onCheckout: (target: string) => void;
  onDeleteBranch: (name: string, force: boolean) => Promise<void>;
  onForceDeleteBranch: (name: string) => void;
}

export function GitConfirmDialogs({
  confirm,
  lastCommit,
  onCancel,
  onUndo,
  onAmend,
  onCheckout,
  onDeleteBranch,
  onForceDeleteBranch,
}: GitConfirmDialogsProps) {
  if (confirm?.kind === 'undo') {
    return (
      <ConfirmDialog
        title="Undo last commit?"
        message={`HEAD will move back one commit. Your changes stay staged — nothing is lost on disk.\n\nThis is equivalent to: git reset --soft HEAD~1`}
        details={lastCommit ? `${lastCommit.hash_short}  ${lastCommit.subject}` : undefined}
        confirmLabel="Undo commit"
        tone="warning"
        onCancel={onCancel}
        onConfirm={() => {
          onCancel();
          onUndo();
        }}
      />
    );
  }

  if (confirm?.kind === 'amend') {
    return (
      <ConfirmDialog
        title="Rewrite commit that's already on the remote?"
        message={
          confirm.pushed
            ? `This commit appears to have been pushed. Amending it rewrites history — anyone who pulled the original will diverge.\n\nYou'll need a force-push (ideally --force-with-lease) to reconcile. Only proceed if you own this branch.`
            : 'This rewrites the current commit with a new message.'
        }
        details={confirm.message}
        confirmLabel="Amend anyway"
        tone={confirm.pushed ? ('danger' as ConfirmTone) : ('warning' as ConfirmTone)}
        confirmWord={confirm.pushed ? 'amend' : undefined}
        onCancel={onCancel}
        onConfirm={() => {
          const message = confirm.message;
          onCancel();
          onAmend(message);
        }}
      />
    );
  }

  if (confirm?.kind === 'dirty-checkout') {
    return (
      <ConfirmDialog
        title={`Switch to ${confirm.target}?`}
        message={`You have ${confirm.dirtyCount} uncommitted change${confirm.dirtyCount === 1 ? '' : 's'}. Git will refuse the checkout if any tracked file would be overwritten, but untracked files may still be clobbered.\n\nConsider stashing first. Proceed anyway?`}
        confirmLabel="Switch anyway"
        tone="warning"
        onCancel={onCancel}
        onConfirm={() => {
          const target = confirm.target;
          onCancel();
          onCheckout(target);
        }}
      />
    );
  }

  if (confirm?.kind === 'delete-branch') {
    return (
      <ConfirmDialog
        title={confirm.force ? `Force-delete ${confirm.name}?` : `Delete ${confirm.name}?`}
        message={
          confirm.force
            ? `This branch contains commits not merged into HEAD. Force-delete discards those commits — if they weren't pushed elsewhere, they're gone.\n\nOnly proceed if you're sure.`
            : `Delete the local branch "${confirm.name}". If it has unmerged commits, git will refuse and you'll get an option to force-delete.`
        }
        confirmLabel={confirm.force ? 'Force delete' : 'Delete'}
        tone={confirm.force ? ('danger' as ConfirmTone) : ('warning' as ConfirmTone)}
        confirmWord={confirm.force ? confirm.name : undefined}
        onCancel={onCancel}
        onConfirm={async () => {
          const { name, force } = confirm;
          onCancel();
          try {
            await onDeleteBranch(name, force);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!force && /not fully merged/i.test(msg)) {
              onForceDeleteBranch(name);
            }
          }
        }}
      />
    );
  }

  return null;
}
