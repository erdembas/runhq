import * as i18n from '@runhq/cockpit-ui/i18n';
import { FolderGit2, GitBranch } from 'lucide-react';
import type { AgentSession } from '@runhq/cockpit-types';

export function AgentSessionProject({ session }: { session: AgentSession }) {
  i18n.useLocale();
  return (
    <div
      aria-label={i18n.t('Conversation project')}
      className="border-border/60 bg-fg/3 mb-2.5 min-w-0 rounded-lg border px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <FolderGit2 className="text-accent h-4 w-4 shrink-0" aria-hidden />
          <span className="text-fg-dim text-[10px]">{i18n.t('Project')}</span>
          <span
            className="text-fg min-w-0 truncate text-[13px] font-semibold"
            title={session.project_name}
          >
            {session.project_name}
          </span>
        </div>
        {session.branch && (
          <span
            className="text-fg-muted flex max-w-full min-w-0 items-center gap-1.5 text-[11px]"
            title={i18n.t('Branch: {value1}', { value1: session.branch })}
          >
            <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{session.branch}</span>
          </span>
        )}
        <span className="bg-fg/5 text-fg-dim shrink-0 rounded px-1.5 py-0.5 text-[10px]">
          {session.isolated ? i18n.t('Isolated worktree') : i18n.t('Local workspace')}
        </span>
      </div>
      <p className="text-fg-muted mt-1.5 truncate font-mono text-[10px]" title={session.cwd}>
        {session.cwd}
      </p>
    </div>
  );
}
