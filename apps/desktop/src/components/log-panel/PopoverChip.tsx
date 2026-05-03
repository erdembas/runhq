import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PopoverChipProps {
  children: ReactNode;
  count: number;
  icon: ReactNode;
  label: string;
  onClose: () => void;
  onToggle: () => void;
  open: boolean;
}

export function PopoverChip({
  children,
  count,
  icon,
  label,
  onClose,
  onToggle,
  open,
}: PopoverChipProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as HTMLElement)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'border-border rounded-app-sm flex h-7 items-center gap-1.5 border px-2 text-[12px] font-medium transition',
          open
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'bg-surface-muted/70 text-fg-muted hover:text-fg hover:bg-surface-overlay',
        )}
      >
        <span className={cn(open ? 'text-accent' : 'text-fg-dim')}>{icon}</span>
        <span>{label}</span>
        {count > 0 && (
          <span
            className={cn(
              'rounded-app-sm ml-0.5 px-1 text-[10px] tabular-nums',
              open ? 'bg-accent/20 text-accent' : 'bg-surface-overlay text-fg-muted',
            )}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="border-border bg-surface-raised rounded-app-lg animate-fade-in absolute top-full right-0 z-50 mt-1.5 w-[360px] overflow-hidden border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          role="dialog"
        >
          {children}
        </div>
      )}
    </div>
  );
}
