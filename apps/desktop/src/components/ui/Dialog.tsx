import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
} as const;

export function Dialog({ title, subtitle, onClose, children, footer, size = 'md' }: Props) {
  i18n.useLocale();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'border-border bg-surface-overlay animate-fade-in rounded-app-lg flex max-h-[85vh] w-full flex-col overflow-hidden border shadow-2xl',
          SIZE[size],
        )}
      >
        <header className="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-fg truncate text-[13px] font-semibold">{title}</h3>
            {subtitle && (
              <p className="text-fg-dim mt-0.5 truncate font-mono text-[11px]" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <IconButton label={i18n.t('Close')} icon={<X />} onClick={onClose} size="md" />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          // Softer action bar: `surface-muted` is a good two-stops-down tint
          // in light mode but reads as heavy sinking in dark mode where the
          // body sits much brighter. Half-opacity `raised` is only one stop
          // down from the body so the footer stays visibly distinct without
          // feeling recessed.
          <footer className="border-border bg-surface-raised/60 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
