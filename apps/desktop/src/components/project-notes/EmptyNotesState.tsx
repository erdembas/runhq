import * as i18n from '@runhq/cockpit-ui/i18n';
import { FileText, Lock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface EmptyNotesStateProps {
  onCreate: () => void;
  serviceName: string;
}

export function EmptyNotesState({ onCreate, serviceName }: EmptyNotesStateProps) {
  i18n.useLocale();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FileText className="text-fg-dim/60 h-7 w-7" />
      <p className="text-fg-dim max-w-sm text-[12.5px] leading-relaxed">
        {i18n.rich(
          "No notes yet for {value1}. Notes are perfect for runbooks, gotchas, environment variables, or anything you don't want to commit.",
          { value1: <code className="font-mono">{serviceName}</code> },
        )}
      </p>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={onCreate}
      >
        {i18n.t('Create your first note')}
      </Button>
      <p className="text-fg-muted/90 max-w-sm text-[11px] leading-relaxed">
        {i18n.rich(
          '{value1}Local-only — saved to your RunHQ folder, never to the repo. AI Chat will pick this up as context for "Project Q&A".',
          { value1: <Lock className="mr-1 inline-block h-3 w-3 align-[-2px]" /> },
        )}
      </p>
    </div>
  );
}
