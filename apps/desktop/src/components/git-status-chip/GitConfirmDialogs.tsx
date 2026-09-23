import * as i18n from '@runhq/cockpit-ui/i18n';
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
  i18n.useLocale();
  if (confirm?.kind === 'undo') {
    return (
      <ConfirmDialog
        title={i18n.t('Undo last commit?')}
        message={i18n.t(
          'HEAD will move back one commit. Your changes stay staged — nothing is lost on disk.\n\nThis is equivalent to: git reset --soft HEAD~1',
        )}
        details={lastCommit ? `${lastCommit.hash_short}  ${lastCommit.subject}` : undefined}
        confirmLabel={i18n.t('Undo commit')}
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
        title={i18n.t("Rewrite commit that's already on the remote?")}
        message={
          confirm.pushed
            ? i18n.t(
                "This commit appears to have been pushed. Amending it rewrites history — anyone who pulled the original will diverge.\n\nYou'll need a force-push (ideally --force-with-lease) to reconcile. Only proceed if you own this branch.",
              )
            : i18n.t('This rewrites the current commit with a new message.')
        }
        details={confirm.message}
        confirmLabel={i18n.t('Amend anyway')}
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
        title={i18n.t('Switch to {value1}?', { value1: confirm.target })}
        message={i18n.t(
          'You have {value1} uncommitted change{plural2}. Git will refuse the checkout if any tracked file would be overwritten, but untracked files may still be clobbered.\n\nConsider stashing first. Proceed anyway?',
          { value1: confirm.dirtyCount, plural2: confirm.dirtyCount === 1 ? '' : 's' },
        )}
        confirmLabel={i18n.t('Switch anyway')}
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
        title={
          confirm.force
            ? i18n.t('Force-delete {value1}?', { value1: confirm.name })
            : i18n.t('Delete {value1}?', { value1: confirm.name })
        }
        message={
          confirm.force
            ? i18n.t(
                "This branch contains commits not merged into HEAD. Force-delete discards those commits — if they weren't pushed elsewhere, they're gone.\n\nOnly proceed if you're sure.",
              )
            : i18n.t(
                'Delete the local branch "{value1}". If it has unmerged commits, git will refuse and you\'ll get an option to force-delete.',
                { value1: confirm.name },
              )
        }
        confirmLabel={confirm.force ? i18n.t('Force delete') : i18n.t('Delete')}
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
