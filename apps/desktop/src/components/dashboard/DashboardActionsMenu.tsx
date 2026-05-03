import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, FolderSearch, Layers, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Overflow menu for the dashboard hero. Houses workspace-level
 * actions that aren't either of the two promoted CTAs ("+ New
 * service" and "Analyze") — so those stay visually dominant in the
 * top-right slot without three near-equal siblings stealing weight.
 *
 * Why a hand-rolled menu (instead of pulling in @radix-ui/dropdown-menu
 * or similar): we already lean on the same click-outside + Escape
 * pattern in `ThemeMenu`/`SectionMenus`/`HistoryDrawer`; adopting it
 * here keeps the bundle lean and matches the local idiom. If a fourth
 * surface needs the same dropdown, that's the right time to extract a
 * shared `DropdownMenu` primitive.
 */
export function DashboardActionsMenu({
  onDiscover,
  onNewStack,
  onRescan,
  disableRescan,
  rescanLabel,
}: {
  onDiscover: () => void;
  onNewStack: () => void;
  onRescan: () => void;
  disableRescan: boolean;
  rescanLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as HTMLElement)) setOpen(false);
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
  }, [open]);

  const close = () => setOpen(false);
  const select = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More workspace actions"
        rightIcon={
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        }
      >
        Actions
      </Button>
      {open && (
        <div
          role="menu"
          className="border-border bg-surface-raised rounded-app animate-fade-in absolute right-0 z-50 mt-1.5 w-[320px] overflow-hidden border py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          <MenuItem
            icon={<FolderSearch className="h-3.5 w-3.5" />}
            label="Discover projects"
            hint="Walk parent folders"
            onClick={select(onDiscover)}
          />
          <MenuItem
            icon={<Layers className="h-3.5 w-3.5" />}
            label="New stack"
            hint="Group services"
            onClick={select(onNewStack)}
          />
          <div className="border-border/60 my-1 border-t" aria-hidden />
          <MenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label={rescanLabel}
            hint="npm outdated · cargo audit · license scan"
            onClick={select(onRescan)}
            disabled={disableRescan}
          />
        </div>
      )}
    </div>
  );
}

const MenuItem = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    label: string;
    hint?: string;
    onClick: () => void;
    disabled?: boolean;
  }
>(function MenuItem({ icon, label, hint, onClick, disabled }, ref) {
  return (
    <button
      ref={ref}
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] whitespace-nowrap transition',
        disabled
          ? 'text-fg-dim/50 cursor-not-allowed'
          : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
      )}
    >
      <span className={cn('shrink-0', disabled ? 'text-fg-dim/50' : 'text-fg-dim')}>{icon}</span>
      <span className="shrink-0 font-medium">{label}</span>
      {hint && <span className="text-fg-dim ml-auto truncate pl-2 text-[10.5px]">{hint}</span>}
    </button>
  );
});
