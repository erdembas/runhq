import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export interface FileContextMenuItem {
  /** Internal id — only used as a React key. */
  id: string;
  label: string;
  /** Optional left-side icon. Pass a Lucide component instance, e.g.
   *  `<Plus size={12} />`. */
  icon?: ReactNode;
  /** Right-aligned hint text — keyboard shortcut, file extension, etc. */
  hint?: string;
  /** When `'danger'` the row is rendered in red and the chosen variant
   *  primes ConfirmDialog elsewhere. UI-only flag here; the caller is
   *  still responsible for actually gating destructive ops. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

export type FileContextMenuEntry = FileContextMenuItem | { id: string; separator: true };

interface FileContextMenuProps {
  /** Cursor coordinates. The menu auto-flips to stay inside the viewport. */
  x: number;
  y: number;
  items: FileContextMenuEntry[];
  onClose: () => void;
}

/**
 * Lightweight controlled context menu — opened by setting state in the
 * parent on `onContextMenu`, closed via the `onClose` callback. Lives
 * in a portal so it can escape any clipped/overflow ancestors.
 *
 * Keyboard contract:
 *  - Esc closes
 *  - Click outside closes
 *  - Click on an item closes (after firing `onClick`)
 *
 * Auto-flip: if the natural position would overflow the viewport on the
 * right or bottom, the menu shifts left / up so it always stays fully
 * visible. We measure the menu's actual rect inside `useLayoutEffect`
 * so the first paint already shows the corrected position — no
 * one-frame jump.
 */
export function FileContextMenu({ x, y, items, onClose }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 6;
    const maxLeft = window.innerWidth - width - margin;
    const maxTop = window.innerHeight - height - margin;
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="border-border bg-surface-overlay fixed z-10001 min-w-[200px] rounded-md border py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry) => {
        if ('separator' in entry) {
          return <div key={entry.id} className="border-border my-1 border-t" />;
        }
        const isDanger = entry.tone === 'danger';
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              if (entry.disabled) return;
              entry.onClick();
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
              entry.disabled
                ? 'text-fg/30 cursor-not-allowed'
                : isDanger
                  ? 'text-rose-400 hover:bg-rose-400/10'
                  : 'text-fg hover:bg-fg/8',
            )}
          >
            {entry.icon && (
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                  entry.disabled ? 'opacity-50' : isDanger ? 'text-rose-400' : 'text-fg/60',
                )}
              >
                {entry.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && (
              <span className="text-fg/40 shrink-0 text-[10.5px] tabular-nums">{entry.hint}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
