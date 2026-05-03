import { useEffect, useRef } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MenuRow } from './MenuRow';
import type { MenuItem } from './overflowMenuTypes';

export function OverflowMenu({
  open,
  setOpen,
  items,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  items: MenuItem[];
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className={cn(
          'text-fg/55 hover:text-fg hover:bg-fg/5 rounded-md p-1.5 transition',
          open && 'text-fg bg-fg/5',
        )}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="bg-surface border-border rounded-app absolute top-full right-0 z-10 mt-1 flex min-w-[180px] flex-col gap-0.5 border p-1 shadow-xl"
        >
          {items.map((it, i) => (
            <MenuRow
              key={it.label ?? `item-${i}`}
              item={it}
              index={i}
              close={() => setOpen(false)}
            />
          ))}
        </div>
      )}
      {open && (
        <span aria-hidden className="text-fg/40 pointer-events-none absolute right-1 -bottom-2">
          <ChevronDown size={6} />
        </span>
      )}
    </div>
  );
}
