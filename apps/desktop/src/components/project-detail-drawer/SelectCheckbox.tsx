import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function SelectCheckbox({
  selected,
  onToggle,
}: {
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition',
        selected
          ? 'bg-accent border-accent text-white'
          : 'border-fg/25 hover:border-fg/50 opacity-0 group-hover/row:opacity-100 focus:opacity-100',
      )}
      aria-label={selected ? 'Deselect row' : 'Select row'}
    >
      {selected && <Check size={9} strokeWidth={3} />}
    </button>
  );
}
