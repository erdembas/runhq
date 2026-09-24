import * as i18n from '@runhq/cockpit-ui/i18n';
import { useLocaleMemo as useMemo } from '@runhq/cockpit-ui/i18n';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FileTypeIcon } from '@/lib/fileIcon';
import {
  buildTree,
  statusColor,
  statusLabel,
  statusLetter,
  type FileEntry,
  type TreeNode,
} from '@/lib/gitDiff';
import type { AgentChangedFile } from './agentChanges';

function ancestorPaths(path: string | undefined): string[] {
  const parts = path?.split('/') ?? [];
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function AgentChangesFileNav({
  files,
  selectedPath,
  onSelect,
  view,
}: {
  files: AgentChangedFile[];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
  view: 'list' | 'tree';
}) {
  i18n.useLocale();
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState(() => new Set(ancestorPaths(selectedPath)));
  const id = useId();

  useEffect(() => {
    if (view !== 'tree') return;
    // Reveal a selection made in the flat list, including compacted directory chains.
    // Do not depend on the file array: background refreshes should preserve manual collapses.
    setExpanded((previous) => {
      const ancestors = ancestorPaths(selectedPath);
      if (ancestors.every((path) => previous.has(path))) return previous;
      return new Set([...previous, ...ancestors]);
    });
  }, [selectedPath, view]);

  const toggleFolder = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderFile = (file: FileEntry, level = 0) => {
    const separator = file.path.lastIndexOf('/');
    const name = file.path.slice(separator + 1);
    const directory = file.path.slice(0, separator);
    const active = selectedPath === file.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(file.path)}
        aria-current={active ? 'true' : undefined}
        title={`${file.path} · ${statusLabel[file.status]}`}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 py-2 pr-3 text-left text-[11px] transition',
          active ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-hover',
        )}
        style={{ paddingLeft: 12 + level * 14 }}
      >
        <FileTypeIcon path={file.path} size={14} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate', file.status === 'deleted' && 'line-through')}>
            {name}
          </span>
          {view === 'list' && separator >= 0 && (
            <span className="text-fg-dim block truncate text-[10px]">{directory}</span>
          )}
        </span>
        <span
          className={cn('shrink-0 text-[10px] font-semibold', statusColor[file.status])}
          aria-label={statusLabel[file.status]}
        >
          {statusLetter[file.status]}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums">
          <span className="text-emerald-400">+{i18n.number(file.additions)}</span>{' '}
          <span className="text-rose-400">−{i18n.number(file.deletions)}</span>
        </span>
      </button>
    );
  };

  const renderNode = (node: TreeNode, level: number): ReactNode => {
    if (node.type === 'file' && node.file) {
      return <li key={`file:${node.fullPath}`}>{renderFile(node.file, level)}</li>;
    }
    const open = expanded.has(node.fullPath);
    const Chevron = open ? ChevronDown : ChevronRight;
    const FolderIcon = open ? FolderOpen : Folder;
    const childrenId = `${id}-${encodeURIComponent(node.fullPath)}`;
    return (
      <li key={`folder:${node.fullPath}`}>
        <button
          type="button"
          title={node.fullPath}
          aria-expanded={open}
          aria-controls={childrenId}
          onClick={() => toggleFolder(node.fullPath)}
          className="text-fg-muted hover:bg-surface-hover flex w-full min-w-0 items-center gap-1.5 py-1.5 pr-3 text-left text-[11px] transition"
          style={{ paddingLeft: 8 + level * 14 }}
        >
          <Chevron size={12} className="text-fg-dim shrink-0" />
          <FolderIcon size={14} className="shrink-0 text-sky-400/70" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="text-fg-dim shrink-0 text-[10px] tabular-nums">
            {i18n.number(node.fileCount)}
          </span>
        </button>
        <ul id={childrenId} hidden={!open}>
          {open && node.children.map((child) => renderNode(child, level + 1))}
        </ul>
      </li>
    );
  };

  return (
    <nav aria-label={i18n.t('Changed files')} className="min-h-0 min-w-0 overflow-auto py-1">
      <ul>
        {view === 'tree'
          ? tree.children.map((node) => renderNode(node, 0))
          : files.map((file) => <li key={file.path}>{renderFile(file)}</li>)}
      </ul>
    </nav>
  );
}
