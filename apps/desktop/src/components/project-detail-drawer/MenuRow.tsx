import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { MenuItem } from './overflowMenuTypes';

export function MenuRow({
  item,
  index,
  close,
}: {
  item: MenuItem;
  index: number;
  close: () => void;
}) {
  const [subOpen, setSubOpen] = useState(false);

  if (item.separator) {
    return <span key={`sep-${index}`} aria-hidden className="bg-border/60 my-0.5 h-px" />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={subOpen}
          onFocus={() => setSubOpen(true)}
          onClick={() => setSubOpen((v) => !v)}
          className={cn(
            'text-fg/80 hover:bg-fg/5 hover:text-fg flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11.5px] transition',
            subOpen && 'bg-fg/5 text-fg',
          )}
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          <ChevronRight size={11} className="text-fg/40 -mr-0.5" />
        </button>
        {subOpen && (
          <div
            role="menu"
            className="bg-surface border-border rounded-app absolute top-0 right-full z-20 mr-1 flex min-w-[180px] flex-col gap-0.5 border p-1 shadow-xl"
          >
            {item.children.map((child, ci) => (
              <MenuRow key={child.label ?? `sub-${ci}`} item={child} index={ci} close={close} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        item.onClick?.();
        close();
      }}
      className="text-fg/80 hover:bg-fg/5 hover:text-fg flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11.5px] transition"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}
