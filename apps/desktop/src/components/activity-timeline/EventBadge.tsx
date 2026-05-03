import { cn } from '@/lib/cn';

/**
 * Badge for the event type — shadcn-style pill with bg tint + colored label.
 * Prominent primary identifier for each row.
 */
export function EventBadge({
  cfg,
  size,
}: {
  cfg: { bg: string; color: string; label: string };
  size: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-semibold tracking-wider uppercase',
        size,
        cfg.bg,
        cfg.color,
      )}
    >
      {cfg.label}
    </span>
  );
}
