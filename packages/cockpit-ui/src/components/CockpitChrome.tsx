import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface Props {
  /** Subtitle shown to the right of the dot cluster — typically the
   *  current cwd or active workspace. */
  title: ReactNode;
  /** Right-aligned status pill (e.g. "Workspace healthy"). Optional. */
  statusPill?: ReactNode;
  /** Body content — the cockpit UI itself. */
  children: ReactNode;
  className?: string;
}

/**
 * macOS-style window chrome wrapping the marketing cockpit demos.
 *
 * Replaces the hand-rolled `.lc-chrome` mock from
 * docs/index.html so the marketing surface no longer maintains a
 * separate visual dialect. The traffic-light dots are non-interactive —
 * users do not expect them to do anything on a static screenshot, and
 * making them interactive would suggest the demo is a real window.
 */
export function CockpitChrome({ title, statusPill, children, className }: Props) {
  return (
    <div
      className={cn(
        'border-border bg-surface-overlay relative overflow-hidden rounded-2xl border shadow-2xl',
        className,
      )}
    >
      <div className="border-border bg-surface-muted/60 flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
        </div>
        <div className="text-fg-muted truncate text-[12px]">{title}</div>
        {statusPill && <div className="ml-auto">{statusPill}</div>}
      </div>
      {children}
    </div>
  );
}
