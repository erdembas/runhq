import { FileText, Lock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface EmptyNotesStateProps {
  onCreate: () => void;
  serviceName: string;
}

export function EmptyNotesState({ onCreate, serviceName }: EmptyNotesStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FileText className="text-fg-dim/60 h-7 w-7" />
      <p className="text-fg-dim max-w-sm text-[12.5px] leading-relaxed">
        No notes yet for <code className="font-mono">{serviceName}</code>. Notes are perfect for
        runbooks, gotchas, environment variables, or anything you don't want to commit.
      </p>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={onCreate}
      >
        Create your first note
      </Button>
      <p className="text-fg-muted/90 max-w-sm text-[11px] leading-relaxed">
        <Lock className="mr-1 inline-block h-3 w-3 align-[-2px]" />
        Local-only — saved to your RunHQ folder, never to the repo. AI Chat will pick this up as
        context for "Project Q&A".
      </p>
    </div>
  );
}
