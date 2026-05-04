import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface TabStripActionProps {
  icon: ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}

export function TabStripAction({ icon, label, title, onClick }: TabStripActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-app-sm flex h-6 items-center gap-1 px-1.5 text-[11px] font-medium transition-colors',
        'text-fg-dim hover:text-fg hover:bg-surface-overlay/60',
        'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
