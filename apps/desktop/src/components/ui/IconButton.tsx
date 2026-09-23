import * as i18n from '@runhq/cockpit-ui/i18n';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'danger' | 'accent';
  size?: 'xs' | 'sm' | 'md';
}

const SIZE = {
  xs: 'h-6 w-6 [&>svg]:h-3 [&>svg]:w-3 rounded-app-sm',
  sm: 'h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5 rounded-app-sm',
  md: 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4 rounded-app',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, icon, tone = 'default', size = 'sm', className, ...rest }, ref) => {
    i18n.useLocale();
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex items-center justify-center transition',
          // `bg-fg/10` gives a neutral hover pad that stays visible on top
          // of every row state — idle, hovered, and the ember-tinted
          // `bg-accent/10` used by selected rows. `bg-surface-raised` used
          // to win on idle rows but disappeared into the selected row's
          // accent wash; `fg/10` is intentionally inverse-of-content so it
          // reads as a "chip" in both light and dark themes.
          tone === 'default' && 'text-fg-muted hover:bg-fg/10 hover:text-fg',
          tone === 'danger' && 'text-fg-muted hover:bg-status-error/15 hover:text-status-error',
          tone === 'accent' && 'text-fg-muted hover:bg-accent/15 hover:text-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          SIZE[size],
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
