import { cn } from '@/lib/cn';
import type { Tone } from './model';

export function RailTile({
  label,
  count,
  active,
  onClick,
  tone,
  neutral,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: Tone;
  neutral?: boolean;
}) {
  // Single-line tile: UPPERCASE label + count inline. Keeps the rail
  // short (one band above the search) and scannable — the count
  // reads as a number, not a headline under a sub-headline.
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'group/tile inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 transition',
        'ring-1 ring-inset',
        active
          ? tone
            ? cn(tone.chipFilled, tone.ring)
            : 'bg-accent/15 text-accent ring-accent/50'
          : 'ring-border hover:bg-fg/4 hover:ring-fg/20',
      )}
    >
      <span
        className={cn(
          'text-[9.5px] leading-none font-semibold tracking-widest uppercase',
          active ? (tone ? tone.text : 'text-accent') : neutral ? 'text-fg/60' : 'text-fg/50',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-[11.5px] leading-none font-semibold tabular-nums',
          active ? (tone ? tone.text : 'text-accent') : 'text-fg/75',
        )}
      >
        {count}
      </span>
    </button>
  );
}
