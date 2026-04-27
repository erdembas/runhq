import { Activity, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/useAppStore';

/**
 * VSCode-style vertical activity bar pinned to the FAR right edge of
 * the window. It's a thin, always-visible 36px rail of icons; clicking
 * an icon either opens the matching panel to its left, switches to
 * that panel if a different one was open, or collapses back to no
 * panel when the active icon is clicked again. The active icon shows
 * a left-side accent strip (mirroring VSCode's left-side strip on the
 * left activity bar — flipped here because we live on the right).
 *
 * The rail is the only handle on visibility; we deliberately do NOT
 * give individual panels their own close button. One control surface
 * = no ambiguity about which thing toggles what.
 */
interface RailItem {
  id: 'activity' | 'ai';
  label: string;
  icon: typeof Activity;
  shortcut?: string;
}

const ITEMS: RailItem[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles, shortcut: '⌘L' },
];

export function RightActivityBar() {
  const active = useAppStore((s) => s.rightPanel);
  const toggle = useAppStore((s) => s.toggleRightPanel);

  return (
    <nav
      className="bg-surface border-border/60 z-30 flex w-9 shrink-0 flex-col items-center gap-1 border-l py-1.5"
      aria-label="Right activity bar"
    >
      {ITEMS.map((item) => {
        const isActive = active === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            // Tooltip carries the shortcut so users discover ⌘L
            // without us having to render a hint label.
            title={item.shortcut ? `${item.label} · ${item.shortcut}` : item.label}
            aria-label={item.label}
            aria-pressed={isActive}
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded transition-colors',
              isActive ? 'text-fg' : 'text-fg-dim hover:text-fg hover:bg-fg/5',
            )}
          >
            {/* Active strip — sits on the LEFT edge of the icon
                button (which is the side facing the panel area), so
                the visual cue points at "this rail item is showing
                the panel to my left". */}
            {isActive && (
              <span
                aria-hidden
                className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-r"
              />
            )}
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </nav>
  );
}
