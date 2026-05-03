import { useEffect } from 'react';
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Star, StarOff, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ContextMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function ContextMenu({
  x,
  y,
  pinned,
  favorite,
  archived,
  onClose,
  onRename,
  onPin,
  onFavorite,
  onArchive,
  onDelete,
}: ContextMenuProps) {
  useEffect(() => {
    const onDown = () => onClose();
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className={cn(
        'fixed z-50 min-w-[180px] py-1',
        'bg-surface-raised border-border/80 rounded-app border shadow-lg shadow-black/30',
      )}
    >
      <MenuItem icon={<Pencil className="h-3 w-3" />} label="Rename" onClick={onRename} />
      <MenuItem
        icon={pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        label={pinned ? 'Unpin' : 'Pin'}
        onClick={onPin}
      />
      <MenuItem
        icon={favorite ? <StarOff className="h-3 w-3" /> : <Star className="h-3 w-3" />}
        label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={onFavorite}
      />
      <MenuItem
        icon={archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
        label={archived ? 'Unarchive' : 'Archive'}
        onClick={onArchive}
      />
      <div className="border-border/60 my-1 border-t" />
      <MenuItem icon={<Trash2 className="h-3 w-3" />} label="Delete…" onClick={onDelete} danger />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition-colors',
        'hover:bg-fg/5',
        danger ? 'text-status-error' : 'text-fg/85',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-status-error' : 'text-fg-dim')}>{icon}</span>
      {label}
    </button>
  );
}
