import * as i18n from '@runhq/cockpit-ui/i18n';
import { ArrowUpRight, GitBranch } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';
import { AgentProviderLogo, AgentStatusBadge, agentProviderNames } from '@runhq/cockpit-ui';

export function AgentDashboardCard({
  session,
  onOpen,
}: {
  session: AgentSession;
  onOpen: () => void;
}) {
  i18n.useLocale();
  const request = session.pending[0];
  const updated = new Date(session.updated_at);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group border-border/70 bg-surface-raised hover:border-accent/40 focus-visible:ring-accent/40 flex min-w-0 flex-col gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2"
    >
      <div className="flex items-center gap-2">
        <AgentProviderLogo
          backend={session.adapter || session.backend}
          className="text-fg-muted h-4 w-4 shrink-0"
        />
        <span className="text-fg-dim min-w-0 flex-1 truncate text-[11px]">
          {session.backend_name || agentProviderNames[session.backend] || session.backend}
        </span>
        {session.unread && (
          <span className="text-accent inline-flex items-center gap-1 text-[10px]">
            {i18n.rich('{value1}Unread', {
              value1: <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-hidden />,
            })}
          </span>
        )}
        <ArrowUpRight
          className="text-fg-dim group-hover:text-accent h-3.5 w-3.5 shrink-0"
          aria-hidden
        />
      </div>
      <h3
        className="text-fg line-clamp-2 text-[14px] leading-5 font-medium break-words"
        title={session.title}
      >
        {session.title}
      </h3>
      <p
        className="text-fg-dim truncate text-[11px]"
        title={session.model || i18n.t('Default model')}
      >
        {session.model || i18n.t('Default model')}
        {session.mode === 'plan' ? i18n.t(' · Plan') : ''}
      </p>
      {request ? (
        <p className="bg-accent/6 text-accent line-clamp-2 rounded-md px-2 py-1.5 text-[11px] leading-relaxed break-words">
          {request.title ||
            (request.kind === 'approval'
              ? i18n.t('Approval requested')
              : i18n.t('Your answer is needed'))}
        </p>
      ) : session.last_error ? (
        <p
          className="text-status-error line-clamp-2 text-[11px] leading-relaxed break-words"
          title={session.last_error}
        >
          {session.last_error}
        </p>
      ) : null}
      {session.branch && (
        <span
          className="text-fg-dim flex min-w-0 items-center gap-1.5 text-[10px]"
          title={session.branch}
        >
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{session.branch}</span>
          {session.isolated && (
            <span className="bg-fg/5 shrink-0 rounded px-1.5 py-0.5">{i18n.t('Worktree')}</span>
          )}
        </span>
      )}
      <div className="border-border/60 mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <AgentStatusBadge status={session.status} pauseState={session.pause_state} />
        <time
          className="text-fg-dim text-[10px]"
          dateTime={updated.toISOString()}
          title={i18n.t('Updated {value1}', {
            value1: updated.toLocaleString(i18n.getFormatLocale()),
          })}
        >
          {updated.toLocaleString(i18n.getFormatLocale(), {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
    </button>
  );
}
