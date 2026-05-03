import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { NoteFile } from '@/types';
import { formatRelativeMs } from './model';

interface NoteRowProps {
  active: boolean;
  note: NoteFile;
  onDelete: () => void;
  onSelect: () => void;
}

export function NoteRow({ active, note, onDelete, onSelect }: NoteRowProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timeout = window.setTimeout(() => setArmed(false), 2500);
    return () => window.clearTimeout(timeout);
  }, [armed]);

  return (
    <li>
      <div
        className={cn(
          'group/note flex items-center gap-1 px-2 py-1',
          active ? 'bg-accent/10' : 'hover:bg-fg/5',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-0.5 text-left transition-colors',
            active ? 'text-fg' : 'text-fg/80',
          )}
        >
          <span className="truncate text-[12px] leading-tight" title={note.title}>
            {note.title}
          </span>
          <span className="text-fg-muted/80 truncate text-[10px] leading-tight">
            {formatRelativeMs(note.updated_at_ms)}
          </span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (armed) {
              setArmed(false);
              onDelete();
            } else {
              setArmed(true);
            }
          }}
          title={armed ? 'Click again to confirm' : 'Delete note'}
          aria-label="Delete note"
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition',
            armed
              ? 'text-tone-critical-fg bg-tone-critical/15'
              : 'text-fg-muted hover:text-tone-critical-fg hover:bg-fg/5 opacity-0 group-hover/note:opacity-100',
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}
