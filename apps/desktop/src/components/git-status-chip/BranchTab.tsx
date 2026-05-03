import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface BranchTabProps {
  active: boolean;
  onClick: () => void;
  count: number;
  children: ReactNode;
}

export function BranchTab({ active, onClick, count, children }: BranchTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[22px] items-center gap-1 rounded px-2 transition',
        active ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:text-fg hover:bg-surface-muted/60',
      )}
    >
      <span>{children}</span>
      <span className="text-fg-dim tabular-nums">{count}</span>
    </button>
  );
}
