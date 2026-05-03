import { cn } from '@/lib/cn';

export function SummaryStat({
  tone,
  count,
  label,
  size,
}: {
  tone: 'emerald' | 'violet' | 'rose';
  count: number;
  label: string;
  size: string;
}) {
  const tones: Record<typeof tone, { dot: string; text: string }> = {
    emerald: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
    violet: { dot: 'bg-violet-400', text: 'text-violet-400' },
    rose: { dot: 'bg-rose-400', text: 'text-rose-400' },
  };
  return (
    <span
      className={cn('flex items-center gap-1.5 font-medium tabular-nums', size, tones[tone].text)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tones[tone].dot)} />
      <span className="text-fg/85">{count}</span>
      <span className="text-fg/45">{label}</span>
    </span>
  );
}
