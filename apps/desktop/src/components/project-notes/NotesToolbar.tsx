import {
  Eye,
  FileText,
  HelpCircle,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import type { NoteFile } from '@/types';
import { ModeButton } from './ModeButton';
import type { NoteViewMode } from './types';

interface NotesToolbarProps {
  activeName: string | null;
  activeNote: NoteFile | null;
  cheatsheetOpen: boolean;
  isDirty: boolean;
  mode: NoteViewMode;
  onDeleteActive: () => void;
  onSave: () => void;
  onSetMode: (mode: NoteViewMode) => void;
  onToggleCheatsheet: () => void;
  onToggleWide: () => void;
  originalContentLength: number;
  saving: boolean;
  serviceName: string;
  wide: boolean;
}

export function NotesToolbar({
  activeName,
  activeNote,
  cheatsheetOpen,
  isDirty,
  mode,
  onDeleteActive,
  onSave,
  onSetMode,
  onToggleCheatsheet,
  onToggleWide,
  originalContentLength,
  saving,
  serviceName,
  wide,
}: NotesToolbarProps) {
  return (
    <div className="border-border/60 bg-surface-raised/30 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
      <div className="text-fg-dim flex min-w-0 items-center gap-2 text-[11px]">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-mono" title={serviceName}>
          {serviceName}
        </span>
        {activeNote && (
          <>
            <span className="text-fg-muted/60 shrink-0">/</span>
            <span className="text-fg/80 truncate font-medium" title={activeNote.title}>
              {activeNote.title}
            </span>
          </>
        )}
        <span
          className="border-border/60 bg-surface-raised/60 text-fg-muted inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-sans text-[10px] tracking-wide uppercase"
          title="These notes live in your local RunHQ folder — not in the repo. Nothing here is committed or shared."
        >
          <Lock className="h-2.5 w-2.5" />
          Local
        </span>
        {isDirty && <span className="text-fg-muted shrink-0 italic">· unsaved</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {activeName && (
          <div
            role="tablist"
            aria-label="Notes view mode"
            className="border-border bg-surface inline-flex items-center rounded-md border p-0.5"
          >
            <ModeButton
              active={mode === 'edit'}
              icon={<Pencil className="h-3 w-3" />}
              label="Edit"
              onClick={() => onSetMode('edit')}
            />
            <ModeButton
              active={mode === 'preview'}
              icon={<Eye className="h-3 w-3" />}
              label="Preview"
              onClick={() => onSetMode('preview')}
            />
          </div>
        )}
        {activeName && mode === 'preview' && (
          <IconButton
            label={wide ? 'Switch to centred layout' : 'Switch to wide layout'}
            icon={
              wide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />
            }
            onClick={onToggleWide}
            size="sm"
            tone={wide ? 'accent' : 'default'}
          />
        )}
        <IconButton
          label="Markdown shortcuts"
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          onClick={onToggleCheatsheet}
          size="sm"
          tone={cheatsheetOpen ? 'accent' : 'default'}
        />
        {activeName && originalContentLength > 0 && (
          <IconButton
            label="Delete note"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onDeleteActive}
            size="sm"
            tone="danger"
          />
        )}
        {activeName && (
          <Button
            variant="primary"
            size="xs"
            leftIcon={<Save className="h-3 w-3" />}
            disabled={!isDirty || saving}
            onClick={onSave}
            title="Save (⌘/Ctrl+S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}
