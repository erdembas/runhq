import * as i18n from '@runhq/cockpit-ui/i18n';
interface GitPopoverHeaderProps {
  upstream: string | null;
}

export function GitPopoverHeader({ upstream }: GitPopoverHeaderProps) {
  i18n.useLocale();
  return (
    <div className="border-border bg-surface-muted text-fg-dim flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
      <span>{i18n.t('Git')}</span>
      <span className="truncate font-mono tracking-normal normal-case">
        {upstream ?? i18n.t('no upstream')}
      </span>
    </div>
  );
}
