import { ArrowRight } from 'lucide-react';
import { runReleaseStoreAction } from './model';
import type { HighlightCta, WhatsNewActionId } from '@/lib/whatsnew';

interface CtaButtonProps {
  cta: HighlightCta;
  onAfter: () => void;
}

export function CtaButton({ cta, onAfter }: CtaButtonProps) {
  if (cta.kind === 'store-action') {
    const actionId: WhatsNewActionId = cta.actionId;
    return (
      <button
        type="button"
        onClick={() => runReleaseStoreAction(actionId, onAfter)}
        className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
      >
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <a
      href={cta.href}
      target="_blank"
      rel="noreferrer noopener"
      className="btn-primary rounded-app-sm inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
    >
      {cta.label}
      <ArrowRight className="h-3.5 w-3.5" />
    </a>
  );
}
