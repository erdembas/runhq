import { useAppStore } from '@/store/useAppStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';

/** Focus belongs to the embedded conversation location, not to a separate task tab. */
export function useAgentFocusMode(): boolean {
  const activeKey = useAppStore((state) => state.activeMainTabKey);
  return useWorkbenchStore((state) => {
    if (!state.focusMode) return false;
    if (activeKey.startsWith('service:')) {
      return state.projectSections[activeKey.slice('service:'.length)] === 'agents';
    }
    return activeKey === 'agents:agents' && state.agentView === 'conversations';
  });
}
