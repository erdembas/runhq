import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { Check, ChevronDown, Copy, FolderGit2, GitBranch, TerminalSquare } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { AgentSession } from '@runhq/cockpit-types';

export function AgentSessionProject({
  session,
  onOpenTerminal,
}: {
  session: AgentSession;
  onOpenTerminal?: () => void;
}) {
  i18n.useLocale();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyPath = async () => {
    setCopyError(null);
    try {
      await writeText(session.cwd);
      setCopied(true);
    } catch (error) {
      setCopied(false);
      setCopyError(String(error));
    }
  };
  return (
    <details
      aria-label={i18n.t('Task workspace')}
      className="group relative max-w-full min-w-0 text-[11px]"
      onToggle={() => {
        setCopied(false);
        setCopyError(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary className="text-fg-muted hover:bg-fg/5 focus-visible:ring-accent/50 flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        <FolderGit2 className="text-fg-dim h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-fg max-w-44 min-w-0 truncate" title={session.project_name}>
          {session.project_name}
        </span>
        {session.branch && (
          <span
            className="text-fg-dim flex max-w-36 min-w-0 items-center gap-1"
            title={i18n.t('Branch: {value1}', { value1: session.branch })}
          >
            <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{session.branch}</span>
          </span>
        )}
        <span className="text-fg-dim shrink-0 text-[10px]">
          {session.isolated ? i18n.t('Isolated worktree') : i18n.t('Local workspace')}
        </span>
        <ChevronDown
          className="text-fg-dim h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-border bg-surface-raised absolute top-full right-0 z-30 mt-1 w-96 max-w-[min(24rem,calc(100vw-3rem))] rounded-lg border p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-fg-muted">{i18n.t('Workspace path')}</span>
          <button
            type="button"
            onClick={() => void copyPath()}
            className="text-fg-muted hover:bg-fg/5 focus-visible:ring-accent/50 flex items-center gap-1.5 rounded px-2 py-1 outline-none focus-visible:ring-2"
            aria-label={i18n.t('Copy workspace path')}
          >
            {copied ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : (
              <Copy className="h-3 w-3" aria-hidden />
            )}
            {copied ? i18n.t('Copied') : i18n.t('Copy')}
          </button>
        </div>
        <p className="text-fg font-mono text-[11px] break-all select-text">{session.cwd}</p>
        {session.workspace && (
          <div className="border-border mt-3 space-y-2 border-t pt-3">
            <p className="text-fg-muted">{i18n.t('Included projects')}</p>
            {session.workspace.members.map((member) => (
              <div key={member.service_id}>
                <p className="text-fg">{member.name}</p>
                <p className="text-fg-dim break-all select-text">{member.path}</p>
              </div>
            ))}
          </div>
        )}
        {session.workspace?.instructions && (
          <details className="text-fg-muted mt-3 text-[11px]">
            <summary className="cursor-pointer">{i18n.t('Shared instructions')}</summary>
            <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
              {session.workspace.instructions}
            </p>
          </details>
        )}
        {onOpenTerminal && (
          <button
            type="button"
            className="text-fg-muted hover:bg-fg/5 focus-visible:ring-accent/50 mt-3 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2"
            onClick={(event) => {
              const menu = event.currentTarget.closest('details');
              if (menu) menu.open = false;
              onOpenTerminal();
            }}
          >
            <TerminalSquare className="h-3.5 w-3.5" aria-hidden />
            {i18n.t('Open workspace terminal')}
          </button>
        )}
        {copyError && (
          <p role="alert" className="text-status-error mt-2 break-words">
            {i18n.t('Could not copy the workspace path.')} {copyError}
          </p>
        )}
      </div>
    </details>
  );
}
