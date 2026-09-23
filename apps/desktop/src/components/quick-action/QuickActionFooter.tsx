import * as i18n from '@runhq/cockpit-ui/i18n';
import { Zap } from 'lucide-react';

export function QuickActionFooter({ inDrill }: { inDrill: boolean }) {
  i18n.useLocale();
  return (
    <div className="border-border/30 bg-surface-muted/30 border-t px-4 py-1.5">
      <div className="text-fg-dim flex items-center gap-3 text-[10px]">
        <span>{i18n.t('↑↓ navigate')}</span>
        {inDrill ? (
          <>
            <span>{i18n.t('⏎ run')}</span>
            <span>{i18n.t('← back')}</span>
            <span>{i18n.t('⌫ empty=back')}</span>
          </>
        ) : (
          <>
            <span>{i18n.t('→ details')}</span>
            <span>{i18n.t('⏎ select')}</span>
            <span>{i18n.t('↹ category')}</span>
          </>
        )}
        <span>
          {i18n.rich('esc {value1}', { value1: inDrill ? i18n.t('back') : i18n.t('close') })}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {i18n.rich('{value1}RunHQ', { value1: <Zap className="text-accent h-2.5 w-2.5" /> })}
        </span>
      </div>
    </div>
  );
}
