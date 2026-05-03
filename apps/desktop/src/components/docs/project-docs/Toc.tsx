import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Heading } from './types';

interface TocProps {
  headings: Heading[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function Toc({ headings, activeId, onSelect }: TocProps) {
  return (
    <nav className="sticky top-2">
      <div className="text-fg-dim mb-2 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-wider uppercase">
        <ShieldCheck className="h-3 w-3" />
        On this page
      </div>
      <ul className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: (h.level - 1) * 8 }}>
            <button
              type="button"
              onClick={() => onSelect(h.id)}
              className={cn(
                'block w-full truncate rounded px-2 py-0.5 text-left text-[11.5px] transition-colors',
                activeId === h.id
                  ? 'text-accent bg-accent/10'
                  : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
              )}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
