import { Bot } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useAppStore } from '@/store/useAppStore';
import { SidebarAgentActivity } from '../sidebar/SidebarAgentActivity';

export function AgentNavigation({ expanded }: { expanded: boolean }) {
  const active = useAppStore((s) => s.activeMainTabKey === 'agents:agents');
  return (
    <div className="relative mx-2 mb-2 flex items-center">
      <button
        onClick={() => useAgentStore.getState().open()}
        aria-label="Agents"
        className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-[12px] ${active ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-fg/5'}`}
      >
        <Bot className="h-4 w-4 shrink-0" />
        {expanded && (
          <>
            <span className="flex-1 text-left">Agents</span>
          </>
        )}
      </button>
      <SidebarAgentActivity
        name="All projects"
        compact={!expanded}
        className={expanded ? 'mr-2' : 'absolute -top-0.5 right-0'}
      />
    </div>
  );
}
export function ProjectAgentButton({ serviceId }: { serviceId: string }) {
  return (
    <button
      title="Open project agents"
      aria-label="Open project agents"
      className="text-fg-muted hover:bg-fg/5 hover:text-accent flex items-center gap-1 rounded-md p-1.5 text-[12px]"
      onClick={() => useAppStore.getState().openServiceWithBodyTab(serviceId, 'agents')}
    >
      <Bot className="h-4 w-4" />
      <span>Agents</span>
    </button>
  );
}
