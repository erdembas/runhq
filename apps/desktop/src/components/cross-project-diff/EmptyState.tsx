import * as i18n from '@runhq/cockpit-ui/i18n';
import { FileDiff, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  search: string;
  anyLoading: boolean;
}

export function EmptyState({ search, anyLoading }: EmptyStateProps) {
  i18n.useLocale();
  if (anyLoading) {
    return (
      <div className="text-fg/40 flex flex-col items-center gap-2 p-6 text-[12px]">
        <RefreshCw size={18} className="animate-spin" />
        <span>{i18n.t('Loading diffs…')}</span>
      </div>
    );
  }

  if (search) {
    return (
      <div className="text-fg/40 p-6 text-center text-[12px]">
        {i18n.rich('No files match {value1}', {
          value1: <span className="text-fg/70 font-mono">{search}</span>,
        })}
      </div>
    );
  }

  return (
    <div className="text-fg/50 flex flex-col items-center gap-3 p-8 text-center text-[12px]">
      <div className="bg-status-running/10 text-status-running flex h-12 w-12 items-center justify-center rounded-full">
        <FileDiff size={24} />
      </div>
      <p className="text-fg/80 font-medium">{i18n.t('All projects clean')}</p>
      <p className="text-fg/40 max-w-[240px] text-[11px]">
        {i18n.t('No uncommitted changes anywhere. Switch branches with confidence.')}
      </p>
    </div>
  );
}
