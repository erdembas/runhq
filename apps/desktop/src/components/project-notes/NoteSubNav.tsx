import { Plus } from 'lucide-react';
import type { NoteFile } from '@/types';
import { NoteRow } from './NoteRow';

interface NoteSubNavProps {
  activeName: string | null;
  loading: boolean;
  notes: NoteFile[];
  onCreate: () => void;
  onDelete: (name: string) => void;
  onSelect: (name: string) => void;
}

export function NoteSubNav({
  activeName,
  loading,
  notes,
  onCreate,
  onDelete,
  onSelect,
}: NoteSubNavProps) {
  return (
    <aside className="border-border/60 bg-surface-raised/20 flex w-[200px] shrink-0 flex-col border-r">
      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="text-fg-muted text-[10px] font-semibold tracking-wider uppercase">
          Notes
        </div>
        <button
          type="button"
          onClick={onCreate}
          title="New note (creates an `untitled` markdown file)"
          aria-label="Create new note"
          className="text-fg-dim hover:text-fg hover:bg-fg/5 inline-flex h-5 w-5 items-center justify-center rounded transition"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-fg-dim px-2 py-2 text-[11px]">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="text-fg-muted px-2 py-3 text-[11px] leading-relaxed">
            No notes yet.
            <br />
            Press{' '}
            <kbd className="border-border bg-surface-muted rounded border px-1 font-mono text-[9.5px]">
              +
            </kbd>{' '}
            to create one.
          </div>
        ) : (
          <ul className="flex flex-col gap-px">
            {notes.map((note) => (
              <NoteRow
                key={note.name}
                note={note}
                active={note.name === activeName}
                onSelect={() => onSelect(note.name)}
                onDelete={() => onDelete(note.name)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
