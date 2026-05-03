import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Scale,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { CardOverflowItem } from './CardOverflowItem';

const OVERFLOW_MENU_WIDTH = 220;
const OVERFLOW_MENU_GAP = 4;
const OVERFLOW_MENU_HEIGHT_ESTIMATE = 180;

type OverflowMenuId = number;
let nextOverflowMenuId: OverflowMenuId = 1;
const overflowMenuListeners = new Set<(activeId: OverflowMenuId | null) => void>();

function announceOverflowMenuActive(activeId: OverflowMenuId | null): void {
  for (const listener of overflowMenuListeners) listener(activeId);
}

interface CardOverflowMenuProps {
  onEdit: () => void;
  onOpenFolder: () => void;
  onNotes: () => void;
  onLicense: () => void;
  isHidden: boolean;
  onToggleHidden: () => void;
  onDelete: () => void;
}

export function CardOverflowMenu({
  onEdit,
  onOpenFolder,
  onNotes,
  onLicense,
  isHidden,
  onToggleHidden,
  onDelete,
}: CardOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef<OverflowMenuId>(0);
  if (idRef.current === 0) idRef.current = nextOverflowMenuId++;

  useEffect(() => {
    const ourId = idRef.current;
    const listener = (activeId: OverflowMenuId | null) => {
      if (activeId !== ourId) setOpen(false);
    };
    overflowMenuListeners.add(listener);
    return () => {
      overflowMenuListeners.delete(listener);
    };
  }, []);

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const above =
      spaceBelow < OVERFLOW_MENU_HEIGHT_ESTIMATE && spaceAbove > OVERFLOW_MENU_HEIGHT_ESTIMATE;
    const left = Math.max(4, rect.right - OVERFLOW_MENU_WIDTH);
    setPos(
      above
        ? { bottom: window.innerHeight - rect.top + OVERFLOW_MENU_GAP, left }
        : { top: rect.bottom + OVERFLOW_MENU_GAP, left },
    );
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    computePosition();
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, computePosition]);

  const select = (fn: () => void) => () => {
    fn();
    setOpen(false);
    announceOverflowMenuActive(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => {
            const next = !v;
            announceOverflowMenuActive(next ? idRef.current : null);
            return next;
          });
        }}
        className={cn(
          'text-fg-dim hover:bg-surface-muted hover:text-fg flex h-7 w-7 items-center justify-center rounded-md transition',
          open && 'bg-surface-muted text-fg',
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className={cn(
              'border-border bg-surface-raised rounded-app animate-fade-in',
              'fixed z-[9999] w-[220px] border py-1',
              'shadow-[0_12px_40px_rgba(0,0,0,0.45)]',
            )}
            style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <CardOverflowItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Edit service"
              onClick={select(onEdit)}
            />
            <CardOverflowItem
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label="Open folder"
              onClick={select(onOpenFolder)}
            />
            <CardOverflowItem
              icon={<FileText className="h-3.5 w-3.5" />}
              label="Project notes"
              onClick={select(onNotes)}
            />
            <CardOverflowItem
              icon={<Scale className="h-3.5 w-3.5" />}
              label="License compliance"
              onClick={select(onLicense)}
            />
            <CardOverflowItem
              icon={isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              label={isHidden ? 'Show on dashboard' : 'Hide from dashboard'}
              onClick={select(onToggleHidden)}
            />
            <div className="border-border/60 my-1 border-t" aria-hidden />
            <CardOverflowItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete service"
              onClick={select(onDelete)}
              danger
            />
          </div>,
          document.body,
        )}
    </>
  );
}
