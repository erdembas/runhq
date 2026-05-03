import { ListTree } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TocHeading } from './types';

interface TocProps {
  activeId: string | null;
  headings: TocHeading[];
  onSelect: (id: string) => void;
}

export function Toc({ activeId, headings, onSelect }: TocProps) {
  return (
    <nav className="sticky top-2">
      <div className="text-fg-dim mb-2 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-wider uppercase">
        <ListTree className="h-3 w-3" />
        On this note
      </div>
      <ul className="flex flex-col gap-0.5">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: (heading.level - 1) * 8 }}>
            <button
              type="button"
              onClick={() => onSelect(heading.id)}
              className={cn(
                'block w-full truncate rounded px-2 py-0.5 text-left text-[11.5px] transition-colors',
                activeId === heading.id
                  ? 'text-accent bg-accent/10'
                  : 'text-fg-muted hover:bg-surface-overlay/60 hover:text-fg',
              )}
              title={heading.text}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
