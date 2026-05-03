import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { FileTypeIcon } from '@/lib/fileIcon';
import {
  statusColor,
  statusLabel,
  statusLetter,
  statusLetterStyle,
  type TreeNode,
} from '@/lib/gitDiff';

interface FileRowProps {
  node: TreeNode;
  level: number;
  isActive: boolean;
  onSelect: () => void;
  action?: ReactNode;
  compactStats?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
}

export function FileRow({
  node,
  level,
  isActive,
  onSelect,
  action,
  compactStats,
  onContextMenu,
}: FileRowProps) {
  const file = node.file!;
  const iconColor = statusColor[file.status];
  const letterStyle = statusLetterStyle[file.status];
  const letter = statusLetter[file.status];
  const deleted = file.status === 'deleted';

  return (
    <div
      className={cn(
        'group relative flex w-full items-center text-[12px] transition-colors',
        isActive ? 'bg-accent/15 text-fg' : 'text-fg/80 hover:bg-fg/6',
      )}
      title={`${statusLabel[file.status]} — ${file.path}`}
      onContextMenu={onContextMenu}
    >
      {isActive && <span className="bg-accent absolute inset-y-0 left-0 w-[2px]" />}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1 text-left"
        style={{ paddingLeft: 12 + level * 14 }}
      >
        <FileTypeIcon path={file.path} size={14} fallbackColor={iconColor} />
        <span className={cn('truncate', deleted && 'line-through opacity-70')}>{node.name}</span>
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-2 tabular-nums">
        {!compactStats && (file.additions > 0 || file.deletions > 0) && (
          <span className={cn('flex items-center gap-1.5', action && 'group-hover:hidden')}>
            {file.additions > 0 && (
              <span className="text-[10px] text-emerald-400/80">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="text-[10px] text-rose-400/80">−{file.deletions}</span>
            )}
          </span>
        )}
        {action && (
          <span
            className={cn(
              'flex items-center gap-0.5',
              !compactStats && (file.additions > 0 || file.deletions > 0)
                ? 'hidden group-hover:flex'
                : 'flex',
            )}
          >
            {action}
          </span>
        )}
        <span
          className="inline-flex items-center justify-center font-bold tabular-nums"
          style={{
            ...letterStyle,
            height: 15,
            minWidth: 15,
            borderRadius: 3,
            paddingLeft: 3,
            paddingRight: 3,
            fontSize: 9.5,
            lineHeight: 1,
          }}
          aria-label={statusLabel[file.status]}
        >
          {letter}
        </span>
      </span>
    </div>
  );
}
