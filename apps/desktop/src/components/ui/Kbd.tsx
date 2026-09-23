import * as i18n from '@runhq/cockpit-ui/i18n';
import { cn } from '@/lib/cn';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  i18n.useLocale();
  return (
    <kbd
      className={cn(
        'border-border bg-surface-muted rounded-app-sm inline-flex h-4 min-w-[18px] items-center justify-center border px-1',
        'text-fg-dim font-mono text-[10px]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
