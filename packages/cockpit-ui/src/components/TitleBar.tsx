import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

interface Props {
  /** Title shown to the right of the traffic-lights cluster. */
  title?: ReactNode;
  /** Right-aligned slot — typically the global "N running" pill. */
  rightSlot?: ReactNode;
  /** Centred search affordance. Provide custom JSX to override the
   *  default "Search services, stacks, actions ⌘K" placeholder. */
  searchSlot?: ReactNode;
  className?: string;
}

/**
 * macOS-style window title bar that wraps the entire desktop
 * dashboard mock. Sits at the top of `<DesktopDashboard />` and holds
 * the traffic-lights cluster + product mark + search affordance.
 *
 * No Tauri-specific drag-region or window-management code lives
 * here — this is purely the visual chrome the marketing surface
 * uses to evoke the real app.
 */
export function TitleBar({ title, rightSlot, searchSlot, className }: Props) {
  return (
    <div
      className={cn(
        'border-border bg-surface-muted/60 flex h-10 shrink-0 items-center gap-3 border-b px-3',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
      </div>
      <div className="text-fg-muted ml-1 flex items-center gap-1.5 text-[11.5px] font-medium">
        <span className="bg-accent inline-block h-3 w-3 rounded-[3px]" aria-hidden />
        <span>{title ?? 'RunHQ'}</span>
      </div>
      <div className="mx-auto flex max-w-md flex-1 items-center justify-center">
        {searchSlot ?? (
          <div className="border-border bg-surface text-fg-dim hover:border-border-strong flex h-7 w-full max-w-sm items-center gap-2 rounded-md border px-2.5 text-[11.5px] transition">
            <Search className="h-3 w-3" />
            <span>Search services, stacks, actions…</span>
            <span className="border-border bg-surface-muted text-fg-dim ml-auto rounded border px-1.5 font-mono text-[10px]">
              ⌘K
            </span>
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  );
}
