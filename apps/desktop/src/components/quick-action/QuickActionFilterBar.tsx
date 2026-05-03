import { cn } from '@/lib/cn';
import type { FilterMode } from './types';
import { QUICK_ACTION_FILTERS } from './filterModes';

interface QuickActionFilterBarProps {
  active: FilterMode;
  onChange: (mode: FilterMode) => void;
}

export function QuickActionFilterBar({ active, onChange }: QuickActionFilterBarProps) {
  return (
    <div className="border-border/30 flex flex-wrap items-center gap-1 gap-y-1 border-b px-4 pb-2">
      {QUICK_ACTION_FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onChange(f.key)}
          className={cn(
            'rounded-app-sm shrink-0 px-2.5 py-0.5 text-[10px] font-medium transition',
            active === f.key
              ? 'bg-accent/15 text-accent'
              : 'text-fg-dim hover:bg-surface-muted hover:text-fg',
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
