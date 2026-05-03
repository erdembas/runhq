import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface DocsNavModeButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function DocsNavModeButton({ active, icon, label, onClick }: DocsNavModeButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-7 items-center justify-center rounded transition',
        active ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:bg-fg/5 hover:text-fg',
      )}
    >
      {icon}
    </button>
  );
}
