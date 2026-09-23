import * as i18n from '@runhq/cockpit-ui/i18n';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'xs' | 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const SIZE: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-app-sm',
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-app-sm',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-app',
};

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary font-medium',
  secondary: 'btn-chrome text-fg',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-raised',
  danger:
    'bg-status-error/10 text-status-error hover:bg-status-error/20 border border-status-error/25',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    { variant = 'secondary', size = 'md', leftIcon, rightIcon, className, children, ...rest },
    ref,
  ) => {
    i18n.useLocale();
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition',
          'disabled:cursor-not-allowed disabled:opacity-50',
          SIZE[size],
          VARIANT[variant],
          className,
        )}
        {...rest}
      >
        {leftIcon}
        {children}
        {rightIcon}
      </button>
    );
  },
);
Button.displayName = 'Button';
