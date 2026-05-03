import { LayoutDashboard, PanelLeftClose, Pin } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';

interface SidebarHomeButtonProps {
  expanded: boolean;
  pinned: boolean;
  selected: boolean;
  onSelect: () => void;
  onTogglePinned: () => void;
}

export function SidebarHomeButton({
  expanded,
  pinned,
  selected,
  onSelect,
  onTogglePinned,
}: SidebarHomeButtonProps) {
  return (
    <div data-tauri-drag-region className="flex items-center justify-between gap-2 px-3 py-2.5">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'rounded-app-sm flex flex-1 items-center gap-2 px-1.5 py-1 transition',
          selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-[5px]',
            selected ? 'bg-accent text-accent-fg' : 'bg-surface-muted text-fg-muted',
          )}
        >
          <LayoutDashboard className="h-3 w-3" />
        </span>
        {expanded && <span className="text-[13px] font-semibold tracking-tight">Dashboard</span>}
      </button>
      {expanded && (
        <IconButton
          label={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
          icon={pinned ? <PanelLeftClose /> : <Pin />}
          size="xs"
          onClick={onTogglePinned}
        />
      )}
    </div>
  );
}
