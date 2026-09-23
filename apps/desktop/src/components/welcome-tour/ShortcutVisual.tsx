import * as i18n from '@runhq/cockpit-ui/i18n';
import { Kbd } from '@/components/ui/Kbd';
import { MOD_SYMBOL } from '@/lib/platform';

export function ShortcutVisual() {
  i18n.useLocale();
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD_SYMBOL}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>⇧</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">{i18n.t('— from anywhere')}</span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-sm">
        <Kbd>{MOD_SYMBOL}</Kbd>
        <span className="text-fg-dim">+</span>
        <Kbd>K</Kbd>
        <span className="text-fg-dim ml-2 text-[11px]">{i18n.t('— inside RunHQ')}</span>
      </div>
    </div>
  );
}
