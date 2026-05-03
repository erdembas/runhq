import { cn } from '@/lib/cn';
import type { ListItem } from '../types';

type AppActionItem = Extract<ListItem, { type: 'app-action' }>;

interface AppActionRowProps {
  item: AppActionItem;
  active: boolean;
  index: number;
  execute: (item: ListItem) => Promise<void>;
  setCursor: (i: number) => void;
}

export function AppActionRow({ item, active, index, execute, setCursor }: AppActionRowProps) {
  return (
    <div
      key={item.id}
      data-active={active ? '' : undefined}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition',
        active ? 'bg-accent/10' : 'hover:bg-surface-muted/50',
      )}
      onClick={() => execute(item)}
      onMouseEnter={() => setCursor(index)}
    >
      <span className="text-fg-muted bg-surface-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
        {item.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-fg text-[12px] font-medium">{item.label}</div>
        <div className="text-fg-dim text-[10px]">{item.subtitle}</div>
      </div>
      <kbd className="text-fg-dim border-border bg-surface-muted shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]">
        {item.shortcut}
      </kbd>
    </div>
  );
}
