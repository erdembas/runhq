import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Semantic severity tones. Use these instead of hard-coded Tailwind colors
 * (red-300, amber-200, etc.) so badges adapt to light/dark mode automatically
 * and stay legible on both surfaces.
 *
 *  - critical → destructive state, errors, vulnerabilities
 *  - warning  → attention, stale data, advisories
 *  - info     → informational, "improved", in-progress
 *  - success  → healthy, completed, fixed, ready
 *  - neutral  → muted/secondary metadata
 *  - accent   → brand emphasis (used sparingly — "new", primary CTA chips)
 */
export type BadgeTone = 'critical' | 'warning' | 'info' | 'success' | 'neutral' | 'accent';

/**
 *  - soft (default)  → tinted background + colored text + tinted ring
 *                      (the workhorse — most badges in the app)
 *  - solid           → filled pill, inverse text (use for *very* prominent
 *                      callouts; can hurt accessibility if overused)
 *  - outline         → no fill, just colored ring + text (subtle metadata)
 */
export type BadgeVariant = 'soft' | 'solid' | 'outline';

export type BadgeSize = 'xs' | 'sm' | 'md';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Optional leading icon (use lucide-react icons sized to match the tier). */
  icon?: ReactNode;
}

/**
 * Tone × variant lookup. Backgrounds use opacity modifiers (e.g. /12) on the
 * *base* tone token so the same class works in both themes — Tailwind v4
 * resolves `tone-*` to a theme-aware CSS variable.
 *
 * Light-mode contrast targets:
 *   • soft:    ~7:1 (text-tone-*-fg on /12 fill)
 *   • solid:   ~9:1 (white text on solid base)
 *   • outline: ~7:1 (text-tone-*-fg on transparent)
 *
 * Dark-mode follows the same model with brighter base + fg shades — see
 * `:root.dark` overrides in styles.css.
 */
const TONE_VARIANT: Record<BadgeTone, Record<BadgeVariant, string>> = {
  critical: {
    soft: 'bg-tone-critical/12 text-tone-critical-fg ring-tone-critical/30',
    solid: 'bg-tone-critical text-white ring-tone-critical',
    outline: 'bg-transparent text-tone-critical-fg ring-tone-critical/45',
  },
  warning: {
    soft: 'bg-tone-warning/15 text-tone-warning-fg ring-tone-warning/35',
    solid: 'bg-tone-warning text-white ring-tone-warning',
    outline: 'bg-transparent text-tone-warning-fg ring-tone-warning/45',
  },
  info: {
    soft: 'bg-tone-info/12 text-tone-info-fg ring-tone-info/30',
    solid: 'bg-tone-info text-white ring-tone-info',
    outline: 'bg-transparent text-tone-info-fg ring-tone-info/45',
  },
  success: {
    soft: 'bg-tone-success/12 text-tone-success-fg ring-tone-success/30',
    solid: 'bg-tone-success text-white ring-tone-success',
    outline: 'bg-transparent text-tone-success-fg ring-tone-success/45',
  },
  neutral: {
    soft: 'bg-tone-neutral/10 text-tone-neutral-fg ring-tone-neutral/25',
    solid: 'bg-tone-neutral text-white ring-tone-neutral',
    outline: 'bg-transparent text-tone-neutral-fg ring-tone-neutral/35',
  },
  accent: {
    soft: 'bg-accent/12 text-accent ring-accent/30',
    solid: 'bg-accent text-accent-fg ring-accent',
    outline: 'bg-transparent text-accent ring-accent/45',
  },
};

const SIZE: Record<BadgeSize, string> = {
  xs: 'h-[18px] px-1.5 text-[10px] tracking-wider uppercase font-semibold gap-1',
  sm: 'h-5 px-2 text-[11px] font-medium gap-1',
  md: 'h-6 px-2.5 text-[12px] font-medium gap-1.5',
};

/**
 * `<Badge>` — the canonical small-status pill for severity, counts, tags and
 * release-note tier markers. Always prefer this over hand-rolled `bg-red-…`
 * combos so light-mode contrast is never an afterthought.
 */
export const Badge = forwardRef<HTMLSpanElement, Props>(
  (
    { tone = 'neutral', variant = 'soft', size = 'xs', icon, className, children, ...rest },
    ref,
  ) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full leading-none whitespace-nowrap ring-1',
        SIZE[size],
        TONE_VARIANT[tone][variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';
