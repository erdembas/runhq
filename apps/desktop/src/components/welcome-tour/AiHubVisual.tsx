import * as i18n from '@runhq/cockpit-ui/i18n';
import { Bot } from 'lucide-react';

export function AiHubVisual() {
  i18n.useLocale();
  return (
    <div className="border-border bg-surface-raised/80 rounded-app-md w-full max-w-[280px] overflow-hidden border shadow-md">
      <div className="border-border bg-surface-overlay/60 flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="text-fg-dim inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
          {i18n.rich('{value1} AI Assistant', { value1: <Bot className="h-3 w-3" /> })}
        </span>
        <span className="border-border bg-surface-muted text-fg-dim rounded-full border px-1.5 py-px font-mono text-[9px]">
          {i18n.t('gpt-4o')}
        </span>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="text-fg-muted text-[10.5px] leading-snug">
          {i18n.t('Why is this build failing?')}
        </div>
        <div className="border-accent/30 bg-accent/5 rounded border-l-2 px-2 py-1.5">
          <div className="text-fg-dim mb-1 text-[9px] font-medium tracking-wide uppercase">
            {i18n.t('Thinking')}
          </div>
          <div className="text-fg-dim/80 line-clamp-2 text-[10px] leading-snug italic">
            {i18n.t('Stack trace points at a missing peer dep after the Tailwind v4 bump…')}
          </div>
        </div>
        <div className="text-fg space-y-1 text-[10.5px] leading-snug">
          <div>
            {i18n.rich('{value1} peer-dep mismatch.', {
              value1: <strong className="font-semibold">{i18n.t('Root cause:')}</strong>,
            })}
          </div>
          <div className="text-fg-muted">{i18n.t('Run `pnpm install --strict-peers`.')}</div>
        </div>
      </div>
    </div>
  );
}
