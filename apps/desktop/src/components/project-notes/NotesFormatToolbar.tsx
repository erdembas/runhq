import {
  Bold,
  Code,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react';
import { FormatButton } from './FormatButton';

interface NotesFormatToolbarProps {
  onFireAction: (id: string) => void;
}

export function NotesFormatToolbar({ onFireAction }: NotesFormatToolbarProps) {
  return (
    <div className="border-border/60 bg-surface flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
      <FormatButton
        icon={<Heading className="h-3.5 w-3.5" />}
        label="Heading (⌘⇧H)"
        onClick={() => onFireAction('runhq.notes.heading')}
      />
      <FormatButton
        icon={<Bold className="h-3.5 w-3.5" />}
        label="Bold (⌘B)"
        onClick={() => onFireAction('runhq.notes.bold')}
      />
      <FormatButton
        icon={<Italic className="h-3.5 w-3.5" />}
        label="Italic (⌘I)"
        onClick={() => onFireAction('runhq.notes.italic')}
      />
      <FormatButton
        icon={<Code className="h-3.5 w-3.5" />}
        label="Inline Code (⌘E)"
        onClick={() => onFireAction('runhq.notes.code')}
      />
      <FormatButton
        icon={<LinkIcon className="h-3.5 w-3.5" />}
        label="Link (⌘K)"
        onClick={() => onFireAction('runhq.notes.link')}
      />
      <div className="bg-border/60 mx-1 h-3.5 w-px" />
      <FormatButton
        icon={<List className="h-3.5 w-3.5" />}
        label="Bullet list (⌘⇧L)"
        onClick={() => onFireAction('runhq.notes.list')}
      />
      <FormatButton
        icon={<ListOrdered className="h-3.5 w-3.5" />}
        label="Numbered list (⌘⇧7)"
        onClick={() => onFireAction('runhq.notes.ordered')}
      />
      <FormatButton
        icon={<Quote className="h-3.5 w-3.5" />}
        label="Block quote (⌘⇧.)"
        onClick={() => onFireAction('runhq.notes.quote')}
      />
    </div>
  );
}
