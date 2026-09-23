import * as i18n from '@runhq/cockpit-ui/i18n';
import { ArrowDown, ArrowUp, Check, GitBranch } from 'lucide-react';
import { GitStatusBadge } from '@/components/ui/GitStatusBadge';
import type { GitStatus } from '@/types';

interface GitStatusSummaryProps {
  git: GitStatus;
  onOpenDiff: () => void;
}

export function GitStatusSummary({ git, onOpenDiff }: GitStatusSummaryProps) {
  i18n.useLocale();
  const { branch, ahead, behind, upstream, head_short } = git;
  const hasUpstream = !!upstream;
  const isSynced = hasUpstream && ahead === 0 && behind === 0;

  return (
    <>
      <div className="flex items-center gap-1.5">
        <GitBranch className="text-accent h-3.5 w-3.5 shrink-0" />
        <span className="text-fg truncate text-[13px] font-semibold">
          {branch ?? i18n.t('detached')}
        </span>
        <span className="text-fg-dim ml-auto shrink-0 font-mono text-[10.5px]">
          {head_short ?? '—'}
        </span>
      </div>

      <div className="text-fg-muted mt-1.5 flex items-center gap-3 text-[11px]">
        {hasUpstream ? (
          isSynced ? (
            <span className="text-status-running inline-flex items-center gap-1">
              {i18n.rich('{value1}up to date', { value1: <Check className="h-3 w-3" /> })}
            </span>
          ) : (
            <>
              {ahead > 0 && (
                <span className="inline-flex items-center gap-1">
                  {i18n.rich('{value1}{value2} ahead', {
                    value1: <ArrowUp className="text-status-running h-3 w-3" />,
                    value2: <span className="tabular-nums">{ahead}</span>,
                  })}
                </span>
              )}
              {behind > 0 && (
                <span className="inline-flex items-center gap-1">
                  {i18n.rich('{value1}{value2} behind', {
                    value1: <ArrowDown className="text-status-starting h-3 w-3" />,
                    value2: <span className="tabular-nums">{behind}</span>,
                  })}
                </span>
              )}
            </>
          )
        ) : (
          <span className="text-fg-dim">{i18n.t('no upstream')}</span>
        )}
        <span className="ml-auto">
          <GitStatusBadge
            git={git}
            onClick={
              git.is_dirty && git.dirty_count > 0
                ? () => {
                    onOpenDiff();
                  }
                : undefined
            }
            title={
              git.is_dirty && git.dirty_count > 0
                ? i18n.t('View {value1} uncommitted change{plural2}', {
                    value1: git.dirty_count,
                    plural2: git.dirty_count === 1 ? '' : 's',
                  })
                : undefined
            }
          />
        </span>
      </div>
    </>
  );
}
