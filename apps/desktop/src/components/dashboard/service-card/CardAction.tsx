import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardActionProps {
  title: string;
  onClick: () => void;
  tone?: 'accent';
  children: ReactNode;
}

export function CardAction({ title, onClick, tone, children }: CardActionProps) {
  const toneClass =
    tone === 'accent'
      ? 'hover:bg-accent/10 hover:text-accent'
      : 'hover:bg-surface-muted hover:text-fg';

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'text-fg-dim flex h-7 w-7 items-center justify-center rounded-md transition',
        toneClass,
      )}
    >
      {children}
    </button>
  );
}
