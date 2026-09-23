import * as i18n from '@runhq/cockpit-ui/i18n';
import { HelpCircle } from 'lucide-react';
import { useAiSurfaceTrigger } from '@/components/ai/useAiSurfaceTrigger';
import { buildWhyChatPayload } from '@/lib/ai/whyPayload';
import type { ProjectOverview } from '@/types';

interface WhyAskButtonProps {
  projectMeta: ProjectOverview;
  flagCount: number;
}

export function WhyAskButton({ projectMeta, flagCount }: WhyAskButtonProps) {
  i18n.useLocale();
  const { triggerRef, onClick, popover } = useAiSurfaceTrigger<HTMLButtonElement>({
    buildPayload: () => {
      const payload = buildWhyChatPayload(projectMeta);
      return {
        origin: 'why',
        title: payload.title,
        context: payload.context,
        draftPrompt: payload.draftPrompt,
        contextSystemMessage: payload.contextSystemMessage,
      };
    },
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={i18n.t('Ask AI: why is this project flagged? ({flagCount} signal{plural2})', {
          flagCount: flagCount,
          plural2: flagCount === 1 ? '' : 's',
        })}
        aria-label={i18n.t('Explain why this project is flagged')}
        className="rounded-app-sm border-accent/30 bg-accent/8 text-accent hover:bg-accent/15 inline-flex h-5 items-center gap-1 border px-1.5 text-[10px] font-semibold transition"
      >
        {i18n.rich('{value1}Why?', { value1: <HelpCircle className="h-3 w-3" /> })}
      </button>
      {popover}
    </>
  );
}
