import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { useCallback } from 'react';
import { Copy, FileText, FolderOpen, Minus, Plus, Trash2, Undo2 } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { FileContextMenuEntry } from '@/components/ui/FileContextMenu';
import type { CommitPanelSide, CommitPanelStore } from '@/components/git/useCommitPanelStore';
import type { FileEntry } from '@/lib/gitDiff';

interface UseCommitContextMenuOptions {
  cwd: string | null;
  patch: CommitPanelStore['patch'];
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
}

export function useCommitContextMenu({
  cwd,
  patch,
  onStageFile,
  onUnstageFile,
}: UseCommitContextMenuOptions) {
  const writeClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Clipboard write failed', err);
    }
  }, []);

  const absolutePath = useCallback(
    (relative: string) => (cwd ? `${cwd.replace(/\/+$/, '')}/${relative}` : relative),
    [cwd],
  );

  const parentDirAbsolute = useCallback(
    (relative: string) => {
      const abs = absolutePath(relative);
      const i = abs.lastIndexOf('/');
      return i > 0 ? abs.slice(0, i) : abs;
    },
    [absolutePath],
  );

  return useCallback(
    (file: FileEntry, side: CommitPanelSide): FileContextMenuEntry[] => {
      const isUntracked = file.status === 'untracked';
      const isDeleted = file.status === 'deleted';
      const abs = absolutePath(file.path);
      const items: FileContextMenuEntry[] = [];

      items.push({
        id: 'open',
        label: i18n.t('Open File'),
        icon: <FileText size={12} />,
        disabled: isDeleted || !cwd,
        onClick: () => void ipc.openPath(abs),
      });
      items.push({
        id: 'reveal',
        label: i18n.t('Reveal in Folder'),
        icon: <FolderOpen size={12} />,
        disabled: !cwd,
        onClick: () => void ipc.openPath(parentDirAbsolute(file.path)),
      });

      items.push({ id: 'sep-1', separator: true });
      items.push({
        id: 'copy-path',
        label: i18n.t('Copy Path'),
        icon: <Copy size={12} />,
        disabled: !cwd,
        onClick: () => void writeClipboard(abs),
      });
      items.push({
        id: 'copy-rel',
        label: i18n.t('Copy Relative Path'),
        icon: <Copy size={12} />,
        onClick: () => void writeClipboard(file.path),
      });

      items.push({ id: 'sep-2', separator: true });
      if (side === 'staged') {
        items.push({
          id: 'unstage',
          label: isDeleted ? i18n.t('Unstage Deletion') : i18n.t('Unstage Changes'),
          icon: <Minus size={12} />,
          onClick: () => void onUnstageFile(file.path),
        });
        return items;
      }

      items.push({
        id: 'stage',
        label: isDeleted
          ? i18n.t('Stage Deletion')
          : isUntracked
            ? i18n.t('Stage File')
            : i18n.t('Stage Changes'),
        icon: <Plus size={12} />,
        onClick: () => void onStageFile(file.path),
      });
      items.push({ id: 'sep-3', separator: true });
      items.push({
        id: 'discard',
        label: isUntracked
          ? i18n.t('Delete File')
          : isDeleted
            ? i18n.t('Restore File')
            : i18n.t('Discard Changes'),
        icon: isUntracked ? <Trash2 size={12} /> : <Undo2 size={12} />,
        tone: isUntracked ? 'danger' : 'default',
        onClick: () => patch({ discardConfirm: { file } }),
      });

      return items;
    },
    [absolutePath, cwd, onStageFile, onUnstageFile, parentDirAbsolute, patch, writeClipboard],
  );
}
