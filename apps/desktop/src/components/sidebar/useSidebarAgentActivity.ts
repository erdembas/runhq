import { createContext, useContext } from 'react';
import type { buildSidebarAgentActivity } from './agentActivityModel';

export const SidebarAgentActivityContext = createContext<ReturnType<
  typeof buildSidebarAgentActivity
> | null>(null);

export function useSidebarAgentActivity(serviceIds?: string[]) {
  const activity = useContext(SidebarAgentActivityContext);
  return serviceIds ? activity?.forServices(serviceIds) : activity?.all;
}
