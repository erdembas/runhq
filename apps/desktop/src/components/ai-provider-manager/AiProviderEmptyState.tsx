import * as i18n from '@runhq/cockpit-ui/i18n';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function AiProviderEmptyState({ onAdd }: { onAdd: () => void }) {
  i18n.useLocale();
  return (
    <div className="border-border bg-surface-muted/30 flex flex-col items-center gap-3 rounded-lg border border-dashed py-5">
      <Sparkles className="text-accent/70 h-7 w-7" />
      <div className="text-center">
        <div className="text-fg text-[13px] font-semibold">{i18n.t('No API providers yet')}</div>
        <p className="text-fg-dim mt-1 max-w-[380px] text-[11.5px] leading-snug">
          {i18n.t(
            'Point RunHQ at any OpenAI-compatible endpoint — a hosted gateway with your own key, or a local server like Ollama or LM Studio. Three fields: URL, optional key, model.',
          )}
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        onClick={onAdd}
      >
        {i18n.t('Add your first provider')}
      </Button>
    </div>
  );
}
