import * as i18n from '@runhq/cockpit-ui/i18n';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { CommitPanelStore } from '@/components/git/useCommitPanelStore';

interface CommitDiscardDialogProps {
  panel: CommitPanelStore;
  patch: CommitPanelStore['patch'];
  onDiscardFile: (path: string) => void;
}

export function CommitDiscardDialog({ panel, patch, onDiscardFile }: CommitDiscardDialogProps) {
  i18n.useLocale();
  if (!panel.discardConfirm) return null;

  const file = panel.discardConfirm.file;
  const isUntracked = file.status === 'untracked';
  const isDeleted = file.status === 'deleted';
  const title = isUntracked
    ? i18n.t('Delete untracked file?')
    : isDeleted
      ? i18n.t('Restore deleted file?')
      : i18n.t('Discard changes?');
  const message = isUntracked
    ? i18n.t(
        'This will permanently delete "{value1}" from disk. Git never tracked it, so it cannot be recovered from history.',
        { value1: file.path },
      )
    : isDeleted
      ? i18n.t('Restore "{value1}" from HEAD? The file will reappear in your working tree.', {
          value1: file.path,
        })
      : i18n.t('All uncommitted changes in "{value1}" will be lost. This cannot be undone.', {
          value1: file.path,
        });

  return (
    <ConfirmDialog
      title={title}
      message={message}
      tone={isDeleted ? 'warning' : 'danger'}
      confirmLabel={
        isUntracked
          ? i18n.t('Delete File')
          : isDeleted
            ? i18n.t('Restore')
            : i18n.t('Discard Changes')
      }
      confirmWord={isUntracked ? 'delete' : undefined}
      onConfirm={() => {
        void onDiscardFile(file.path);
        patch({ discardConfirm: null });
        if (panel.selected?.kind === 'unstaged' && panel.selected.path === file.path) {
          patch({ selected: null, fileDiff: null });
        }
      }}
      onCancel={() => patch({ discardConfirm: null })}
    />
  );
}
