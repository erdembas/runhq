import { ArrowRight } from 'lucide-react';
import { runModalStoreAction } from './model';
import type { HighlightCta, WhatsNewActionId } from '@/lib/whatsnew';

interface CtaButtonProps {
  cta: HighlightCta;
  onAction: () => void;
}

export function CtaButton({ cta, onAction }: CtaButtonProps) {
  if (cta.kind === 'store-action') {
    const actionId: WhatsNewActionId = cta.actionId;
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={() => runModalStoreAction(actionId, onAction)}
          className="btn-chrome rounded-app-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
        >
          {cta.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="pt-1">
      <a
        href={cta.href}
        target="_blank"
        rel="noreferrer noopener"
        className="btn-chrome rounded-app-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
      >
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
