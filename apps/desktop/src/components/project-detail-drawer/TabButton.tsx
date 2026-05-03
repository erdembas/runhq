import { cn } from '@/lib/cn';
import type { Tone } from './model';

export function TabButton({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: Tone | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-medium transition',
        active ? 'text-fg' : 'text-fg/50 hover:text-fg/80',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] tabular-nums',
          active ? (tone ? tone.text : 'text-fg/60') : 'text-fg/35',
        )}
      >
        {count}
      </span>
      {active && (
        <span
          className={cn(
            'absolute inset-x-4 -bottom-px h-[2px] rounded-full',
            tone ? tone.underline : 'bg-accent',
          )}
        />
      )}
    </button>
  );
}
