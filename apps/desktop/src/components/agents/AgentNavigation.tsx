import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { BookOpen, Bot, ChartNoAxesCombined, GitPullRequest, Inbox, Wrench } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useAppStore } from '@/store/useAppStore';
import { useWorkbenchStore, type AgentWorkspaceView } from '@/store/useWorkbenchStore';
import { openAgentView, openProjectAgentView } from '@/lib/workbenchNavigation';
import { SidebarAgentActivity } from '../sidebar/SidebarAgentActivity';
import { useAgentWorkflowAttention } from './useAgentWorkflowAttention';

export function AgentNavigation({ expanded }: { expanded: boolean }) {
  i18n.useLocale();
  const activeKey = useAppStore((s) => s.activeMainTabKey);
  const view = useWorkbenchStore((s) => s.agentView);
  const { entries: workflowAttention } = useAgentWorkflowAttention();
  const pending = useAgentStore((s) =>
    Object.values(s.sessions).reduce((sum, session) => sum + session.pending.length, 0),
  );
  const items: Array<{ view: AgentWorkspaceView; label: string; icon: typeof Bot }> = [
    { view: 'overview', label: i18n.t('Tasks'), icon: Bot },
    { view: 'inbox', label: i18n.t('Attention center'), icon: Inbox },
    { view: 'workflows', label: i18n.t('Workflows'), icon: GitPullRequest },
    { view: 'library', label: i18n.t('Library'), icon: BookOpen },
  ];
  return (
    <nav
      aria-label={i18n.t('Workbench navigation')}
      className="border-border/60 mx-2 mb-3 space-y-0.5 border-b pb-3"
    >
      {items.map(({ view: destination, label, icon: Icon }) => {
        const active =
          destination === 'overview'
            ? activeKey === 'agents:agents' && ['overview', 'conversations'].includes(view)
            : activeKey === 'agents:agents' && destination === view;
        return (
          <div key={destination} className="relative flex items-center">
            <button
              type="button"
              onClick={() => openAgentView(destination, '')}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              title={expanded ? undefined : label}
              className={`flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-[12px] transition-colors ${active ? 'bg-accent/10 text-accent font-medium' : 'text-fg-muted hover:bg-fg/5 hover:text-fg'}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {expanded && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
              {destination === 'inbox' && pending + workflowAttention.length > 0 && (
                <span className="bg-accent/15 text-accent rounded-md px-1.5 py-0.5 text-[10px] tabular-nums">
                  {i18n.number(pending + workflowAttention.length)}
                </span>
              )}
            </button>
            {destination === 'overview' && (
              <SidebarAgentActivity
                name="All projects"
                compact={!expanded}
                className={expanded ? 'mr-2' : 'absolute -top-0.5 right-0'}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function WorkbenchUtilities({ expanded }: { expanded: boolean }) {
  i18n.useLocale();
  return (
    <div
      className={`border-border/60 flex shrink-0 items-center justify-evenly gap-1 border-t px-2 py-2 ${expanded ? '' : 'flex-col'}`}
      aria-label={i18n.t('Workspace tools')}
    >
      <button
        type="button"
        onClick={() => openAgentView('usage', '')}
        title={i18n.t('Usage')}
        aria-label={i18n.t('Usage')}
        className="text-fg-muted hover:bg-fg/5 hover:text-fg flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]"
      >
        <ChartNoAxesCombined className="h-3.5 w-3.5" />
        {expanded && i18n.t('Usage')}
      </button>
      <button
        type="button"
        onClick={() => useAgentStore.setState({ toolsOpen: true })}
        title={i18n.t('Agent connections')}
        aria-label={i18n.t('Agent connections')}
        className="text-fg-muted hover:bg-fg/5 hover:text-fg flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]"
      >
        <Wrench className="h-3.5 w-3.5" />
        {expanded && i18n.t('Agent connections')}
      </button>
    </div>
  );
}

export function ProjectAgentButton({ serviceId }: { serviceId: string }) {
  i18n.useLocale();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        title={i18n.t('Open project tasks')}
        aria-label={i18n.t('Open project tasks')}
        className="text-fg-muted hover:bg-fg/5 hover:text-accent flex items-center gap-1 rounded-md p-1.5 text-[12px]"
        onClick={() => {
          setError(null);
          void openProjectAgentView(serviceId, 'overview').catch(() =>
            setError(i18n.t('Could not open project tasks.')),
          );
        }}
      >
        <Bot className="h-4 w-4" />
        <span>{i18n.t('Tasks')}</span>
      </button>
      {error && (
        <p role="alert" className="text-status-error text-[11px]">
          {error}
        </p>
      )}
    </div>
  );
}
