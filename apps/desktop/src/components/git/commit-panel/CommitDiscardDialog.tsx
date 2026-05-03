import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { CommitPanelStore } from '@/components/git/useCommitPanelStore';

interface CommitDiscardDialogProps {
  panel: CommitPanelStore;
  patch: CommitPanelStore['patch'];
  onDiscardFile: (path: string) => void;
}

export function CommitDiscardDialog({ panel, patch, onDiscardFile }: CommitDiscardDialogProps) {
  if (!panel.discardConfirm) return null;

  const file = panel.discardConfirm.file;
  const isUntracked = file.status === 'untracked';
  const isDeleted = file.status === 'deleted';
  const title = isUntracked
    ? 'Delete untracked file?'
    : isDeleted
      ? 'Restore deleted file?'
      : 'Discard changes?';
  const message = isUntracked
    ? `This will permanently delete "${file.path}" from disk. Git never tracked it, so it cannot be recovered from history.`
    : isDeleted
      ? `Restore "${file.path}" from HEAD? The file will reappear in your working tree.`
      : `All uncommitted changes in "${file.path}" will be lost. This cannot be undone.`;

  return (
    <ConfirmDialog
      title={title}
      message={message}
      tone={isDeleted ? 'warning' : 'danger'}
      confirmLabel={isUntracked ? 'Delete File' : isDeleted ? 'Restore' : 'Discard Changes'}
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
