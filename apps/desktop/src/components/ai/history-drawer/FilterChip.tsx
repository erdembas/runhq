import { cn } from '@/lib/cn';

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}

export function FilterChip({ active, onClick, label, icon }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[10.5px] font-medium transition-colors',
        active ? 'bg-accent/12 text-accent' : 'text-fg-dim hover:bg-fg/5 hover:text-fg/90',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
