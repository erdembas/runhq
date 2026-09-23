import * as i18n from '@runhq/cockpit-ui/i18n';
import { Rocket } from 'lucide-react';

export function ReadyVisual() {
  i18n.useLocale();
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-accent/15 text-accent flex h-16 w-16 items-center justify-center rounded-full">
        <Rocket className="h-8 w-8" strokeWidth={1.8} />
      </div>
      <div className="text-fg-dim text-center text-[12px] leading-relaxed">
        {i18n.rich('You can re-open this tour anytime from{value1}.', {
          value1: (
            <span className="text-fg ml-1 font-medium">{i18n.t('Settings → Shortcuts')}</span>
          ),
        })}
      </div>
    </div>
  );
}
