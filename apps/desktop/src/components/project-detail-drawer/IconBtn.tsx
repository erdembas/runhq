import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function IconBtn({
  label,
  onClick,
  children,
  size = 'md',
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows are clickable to toggle selection; nested action buttons
        // must not also flip the selection when tapped.
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={cn(
        'text-fg/55 hover:text-fg hover:bg-fg/5 rounded-md transition',
        size === 'sm' ? 'p-1' : 'p-1.5',
      )}
    >
      {children}
    </button>
  );
}
