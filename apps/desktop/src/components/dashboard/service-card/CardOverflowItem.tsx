import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardOverflowItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function CardOverflowItem({ icon, label, onClick, danger }: CardOverflowItemProps) {
  return (
    <button
      role="menuitem"
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] whitespace-nowrap transition',
        danger
          ? 'text-status-error hover:bg-status-error/10'
          : 'text-fg-muted hover:bg-accent/10 hover:text-fg',
      )}
    >
      <span
        className={cn(
          'rounded-app-sm flex h-5 w-5 shrink-0 items-center justify-center',
          danger ? 'bg-status-error/10 text-status-error' : 'bg-surface-muted text-fg-muted',
        )}
      >
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}
