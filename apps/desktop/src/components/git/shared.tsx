import { type ReactNode } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileImage,
  Binary,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ipc } from '@/lib/ipc';
import {
  type TreeNode,
  statusBadgeBg,
  statusColor,
  statusLabel,
  statusLetter,
  statusLetterStyle,
  isImagePath,
  humanKind,
  fileExt,
} from '@/lib/gitDiff';
import { FileTypeIcon } from '@/lib/fileIcon';
// `statusBadgeBg` is still used by `BinaryPreview` below; `FileRow` now
// renders VSCode-style plain coloured letters instead of pills.
import type { FileDiffStatus } from '@/types';

interface FileRowProps {
  node: TreeNode;
  level: number;
  isActive: boolean;
  onSelect: () => void;
  /** Optional right-edge action element (e.g. stage / unstage button).
   *  Rendered IMMEDIATELY left of the status letter so the letter always
   *  sits at the far right — exactly like VSCode's Source Control pane. */
  action?: ReactNode;
  /** When true, the +/− stats are hidden. Used in narrow sidebars like
   *  the Commit tab where the right edge is already crowded. */
  compactStats?: boolean;
  /** Right-click handler. Receives the raw mouse event so the caller can
   *  position a context menu at the cursor. We deliberately do NOT
   *  preventDefault inside the row — that's the caller's choice. */
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * VSCode Source Control parity:
 *  - left status rail (subtle)
 *  - status-colored file icon
 *  - filename (strike-through for deletions)
 *  - optional additions / deletions stats (dim, hidden on hover when action slot exists)
 *  - hover action(s) (stage / unstage)
 *  - status letter (M/A/D/U/R/C) at the far right — bold + colored, not a pill,
 *    so nobody mistakes it for a checkbox again.
 */
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
      {/* Active selection rail only — status is already communicated
          via the right-edge letter and the status-tinted file icon, so
          the left-edge status bar was redundant noise. VSCode parity. */}
      {isActive && <span className="bg-accent absolute inset-y-0 left-0 w-[2px]" />}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1 text-left"
        // File rows sit 8px deeper than their parent folder (see
        // FolderRow below: base 4 vs file base 12). 14px per level is a
        // touch more generous than VSCode's 12px which makes the tree
        // noticeably easier to scan at 1x density.
        style={{ paddingLeft: 12 + level * 14 }}
      >
        <FileTypeIcon path={file.path} size={14} fallbackColor={iconColor} />
        <span className={cn('truncate', deleted && 'line-through opacity-70')}>{node.name}</span>
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-2 tabular-nums">
        {/* Stats + action share the same right-edge slot. Stats vanish on
            hover so the action replaces them — this matches VSCode where
            stage / discard icons take over when you're about to act. */}
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
              // When stats are present they already occupy the slot, so
              // the action only appears on hover. When there are no stats
              // (or compactStats is on) the action is always visible so
              // it's discoverable without hunting for a hover target.
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

interface FolderRowProps {
  node: TreeNode;
  level: number;
  expanded: boolean;
  onToggle: () => void;
}

export function FolderRow({ node, level, expanded, onToggle }: FolderRowProps) {
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const folderColor =
    node.mixedStatus || !node.status ? 'text-sky-400/70' : statusColor[node.status];
  return (
    <button
      onClick={onToggle}
      className="text-fg/80 hover:bg-fg/6 group flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] transition-colors"
      // 14px per level (matches file rows); folder base padding is 4px
      // so the chevron sits at the very left edge while the folder's
      // direct children (files) visually offset by ~8px to its right.
      style={{ paddingLeft: 4 + level * 14 }}
    >
      <Chevron size={12} className="text-fg/40 shrink-0" strokeWidth={2} />
      <FolderIcon size={13} className={cn('shrink-0', folderColor)} strokeWidth={1.6} />
      <span className="truncate">{node.name}</span>
      <span className="text-fg/30 ml-auto shrink-0 text-[10px] tabular-nums">{node.fileCount}</span>
    </button>
  );
}

interface TreeViewProps {
  node: TreeNode;
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  /** Render a per-file action (e.g. stage / unstage). */
  renderFileAction?: (node: TreeNode) => ReactNode;
  compactStats?: boolean;
  /** Right-click handler. The TreeNode passed in is the *file* node
   *  (folders never get a context menu by design — VSCode does the same
   *  thing). The mouse event is forwarded so callers can position the
   *  menu at the cursor without needing a synthetic event. */
  onContextMenuFile?: (node: TreeNode, e: React.MouseEvent) => void;
}

export function TreeView({
  node,
  level,
  expanded,
  onToggle,
  selectedFile,
  onSelect,
  renderFileAction,
  compactStats,
  onContextMenuFile,
}: TreeViewProps) {
  if (node.type === 'file' && node.file) {
    return (
      <FileRow
        node={node}
        level={level}
        isActive={selectedFile === node.file.path}
        onSelect={() => onSelect(node.file!.path)}
        action={renderFileAction?.(node)}
        compactStats={compactStats}
        onContextMenu={
          onContextMenuFile
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenuFile(node, e);
              }
            : undefined
        }
      />
    );
  }
  const isExpanded = expanded.has(node.fullPath);
  return (
    <>
      {node.fullPath !== '' && (
        <FolderRow
          node={node}
          level={level}
          expanded={isExpanded}
          onToggle={() => onToggle(node.fullPath)}
        />
      )}
      {(node.fullPath === '' || isExpanded) &&
        node.children.map((child) => (
          <TreeView
            key={`${child.type}:${child.fullPath || child.name}`}
            node={child}
            level={node.fullPath === '' ? level : level + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedFile={selectedFile}
            onSelect={onSelect}
            renderFileAction={renderFileAction}
            compactStats={compactStats}
            onContextMenuFile={onContextMenuFile}
          />
        ))}
    </>
  );
}

interface BinaryPreviewProps {
  path: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
  cwd: string | null;
}

export function BinaryPreview({ path, status, additions, deletions, cwd }: BinaryPreviewProps) {
  const isImage = isImagePath(path);
  const kind = humanKind(path);
  const ext = fileExt(path);
  const fullPath = cwd ? `${cwd.replace(/\/$/, '')}/${path}` : null;
  const Icon = isImage ? FileImage : Binary;
  const statusVerb: Record<FileDiffStatus, string> = {
    added: 'Added to working tree',
    modified: 'Modified — contents changed',
    deleted: 'Deleted from working tree',
    renamed: 'Renamed',
    copied: 'Copied',
    untracked: 'New untracked file',
  };
  const headline: Record<FileDiffStatus, string> = {
    added: 'New binary file',
    modified: 'Binary file changed',
    deleted: 'Binary file removed',
    renamed: 'Binary file renamed',
    copied: 'Binary file copied',
    untracked: 'Untracked binary file',
  };

  return (
    <div className="bg-surface flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div
        className={cn(
          'flex h-20 w-20 items-center justify-center rounded-2xl border',
          'border-border bg-surface-muted/40',
          statusColor[status],
        )}
      >
        <Icon size={42} strokeWidth={1.2} />
      </div>
      <div className="space-y-1">
        <h3 className="text-fg text-base font-semibold tracking-tight">{headline[status]}</h3>
        <p className="text-fg/60 max-w-md text-xs">
          Monaco doesn&apos;t render {kind.toLowerCase()} diffs — Git tracks this file as binary, so
          a line-by-line comparison isn&apos;t meaningful.
        </p>
      </div>
      <div className="border-border bg-surface-muted/40 flex items-center gap-3 rounded-md border px-3 py-2 text-[11px]">
        <span
          className={cn(
            'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums ring-1',
            statusBadgeBg[status],
          )}
          title={statusLabel[status]}
        >
          {statusLetter[status]}
        </span>
        <span className="text-fg/70">{statusVerb[status]}</span>
        {(additions > 0 || deletions > 0) && <span className="text-fg/40">·</span>}
        {additions > 0 && <span className="text-emerald-400 tabular-nums">+{additions}</span>}
        {deletions > 0 && <span className="text-rose-400 tabular-nums">−{deletions}</span>}
        {ext && (
          <>
            <span className="text-fg/40">·</span>
            <span className="text-fg/50 uppercase">{ext}</span>
          </>
        )}
      </div>
      <div className="text-fg/40 max-w-lg truncate font-mono text-[11px]" title={path}>
        {path}
      </div>
      {fullPath && status !== 'deleted' && (
        <button
          onClick={() => void ipc.openPath(fullPath)}
          className="border-border bg-surface-muted/60 text-fg/80 hover:bg-fg/10 hover:text-fg flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition"
          title={fullPath}
        >
          <ExternalLink size={12} />
          Open in default app
        </button>
      )}
    </div>
  );
}
