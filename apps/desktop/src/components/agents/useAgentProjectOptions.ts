import { useMemo } from 'react';
import type { AgentProject } from '@runhq/cockpit-types';
import { useAppStore } from '@/store/useAppStore';
import { agentProjectOptions } from './agentProjectOptions';
import { useVisibleStore } from '@/lib/useVisibleStore';

export function useAgentProjectOptions(projects: AgentProject[], visible = true) {
  const services = useVisibleStore(useAppStore, (state) => state.services, visible);
  const stacks = useVisibleStore(useAppStore, (state) => state.stacks, visible);
  const sections = useVisibleStore(useAppStore, (state) => state.sections, visible);
  const serviceSection = useVisibleStore(useAppStore, (state) => state.serviceSection, visible);
  const stackSection = useVisibleStore(useAppStore, (state) => state.stackSection, visible);
  return useMemo(
    () => agentProjectOptions(projects, services, stacks, sections, serviceSection, stackSection),
    [projects, services, stacks, sections, serviceSection, stackSection],
  );
}
