import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CheckRowProps {
  checked: boolean;
  onToggle: () => void;
  leading: React.ReactNode;
  label: string;
  count: number;
}

export function CheckRow({ checked, onToggle, leading, label, count }: CheckRowProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'rounded-app-sm group flex w-full items-center gap-2 px-2 py-1 text-left transition',
        checked ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-overlay hover:text-fg',
      )}
    >
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition',
          checked
            ? 'bg-accent border-accent text-accent-fg'
            : 'border-border/80 group-hover:border-border-strong',
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {leading}
        {label && <span className="truncate text-[11.5px] font-medium">{label}</span>}
      </span>
      <span className="text-fg-dim text-[10px] tabular-nums">{count}</span>
    </button>
  );
}
