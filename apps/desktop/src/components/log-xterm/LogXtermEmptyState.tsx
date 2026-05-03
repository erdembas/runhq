import { cn } from '@/lib/cn';
import { XTERM_DARK_BG, XTERM_LIGHT_BG } from '@/lib/xtermTheme';

interface LogXtermEmptyStateProps {
  isDark: boolean;
  message: string;
}

export function LogXtermEmptyState({ isDark, message }: LogXtermEmptyStateProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center',
        'text-fg-dim text-[11px]',
      )}
      style={{ backgroundColor: isDark ? XTERM_DARK_BG : XTERM_LIGHT_BG }}
    >
      {message}
    </div>
  );
}
