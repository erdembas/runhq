import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface IconToolProps {
  onClick: () => void;
  tooltip: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
}

export function IconTool({ onClick, tooltip, icon, active, disabled }: IconToolProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition',
        active ? 'bg-accent/20 text-accent' : 'text-fg/50 hover:text-fg hover:bg-fg/10',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {icon}
    </button>
  );
}
