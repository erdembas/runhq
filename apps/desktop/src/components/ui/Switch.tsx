import * as i18n from '@runhq/cockpit-ui/i18n';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Render just the pill, no label/description block. */
  bare?: boolean;
  className?: string;
}

/**
 * Compact macOS-style toggle switch.
 *
 * Preferred over `<input type="checkbox">` for boolean settings that have a
 * behavioural side-effect (e.g. "auto-start on app launch"): the pill
 * conveys a state change rather than a filter selection. Use a checkbox for
 * list/batch selection instead.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  bare,
  className,
}: Props) {
  i18n.useLocale();
  const pill = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border transition',
        checked ? 'bg-accent border-accent' : 'bg-surface-muted border-border',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full shadow-sm transition',
          checked ? 'bg-accent-fg left-[15px]' : 'bg-fg-muted left-[2px]',
        )}
      />
    </button>
  );

  if (bare) return pill;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-3',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {label && <div className="text-fg text-[12px] font-medium">{label}</div>}
        {description && (
          <div className="text-fg-dim mt-0.5 text-[10.5px] leading-snug">{description}</div>
        )}
      </div>
      {pill}
    </label>
  );
}
