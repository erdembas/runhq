import * as i18n from '@runhq/cockpit-ui/i18n';
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
  i18n.useLocale();
  return (
    <div className="border-border/60 bg-surface flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
      <FormatButton
        icon={<Heading className="h-3.5 w-3.5" />}
        label={i18n.t('Heading (⌘⇧H)')}
        onClick={() => onFireAction('runhq.notes.heading')}
      />
      <FormatButton
        icon={<Bold className="h-3.5 w-3.5" />}
        label={i18n.t('Bold (⌘B)')}
        onClick={() => onFireAction('runhq.notes.bold')}
      />
      <FormatButton
        icon={<Italic className="h-3.5 w-3.5" />}
        label={i18n.t('Italic (⌘I)')}
        onClick={() => onFireAction('runhq.notes.italic')}
      />
      <FormatButton
        icon={<Code className="h-3.5 w-3.5" />}
        label={i18n.t('Inline Code (⌘E)')}
        onClick={() => onFireAction('runhq.notes.code')}
      />
      <FormatButton
        icon={<LinkIcon className="h-3.5 w-3.5" />}
        label={i18n.t('Link (⌘K)')}
        onClick={() => onFireAction('runhq.notes.link')}
      />
      <div className="bg-border/60 mx-1 h-3.5 w-px" />
      <FormatButton
        icon={<List className="h-3.5 w-3.5" />}
        label={i18n.t('Bullet list (⌘⇧L)')}
        onClick={() => onFireAction('runhq.notes.list')}
      />
      <FormatButton
        icon={<ListOrdered className="h-3.5 w-3.5" />}
        label={i18n.t('Numbered list (⌘⇧7)')}
        onClick={() => onFireAction('runhq.notes.ordered')}
      />
      <FormatButton
        icon={<Quote className="h-3.5 w-3.5" />}
        label={i18n.t('Block quote (⌘⇧.)')}
        onClick={() => onFireAction('runhq.notes.quote')}
      />
    </div>
  );
}
