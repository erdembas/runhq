import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ModeButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function ModeButton({ active, icon, label, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition',
        active ? 'bg-fg/10 text-fg' : 'text-fg-dim hover:text-fg hover:bg-fg/5',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
