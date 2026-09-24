import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AgentActivityBadge, type AgentActivitySummary } from '@runhq/cockpit-ui';
import { useAgentStore } from '@/store/useAgentStore';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { openAgentTask, openAgentView } from '@/lib/workbenchNavigation';
import {
  agentProjectPathKey,
  buildSidebarAgentActivity,
  createAgentActivitySelector,
} from './agentActivityModel';

import { SidebarAgentActivityContext, useSidebarAgentActivity } from './useSidebarAgentActivity';
const projectResolutions = new Map<string, Promise<string | undefined>>();

export function SidebarAgentActivityProvider({ children }: { children: ReactNode }) {
  i18n.useLocale();
  const services = useAppStore((state) => state.services);
  const projects = useAgentStore((state) => state.projects);
  const selectActivitySessions = useMemo(createAgentActivitySelector, []);
  const sessions = useAgentStore(selectActivitySessions);
  const ready = useAgentStore((state) => state.ready);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const projectPaths = new Set(projects.map((project) => agentProjectPathKey(project.path)));
    for (const service of services) {
      const key = agentProjectPathKey(service.cwd);
      if (projectPaths.has(key) || resolved[key]) continue;
      // Symlinked service directories need filesystem canonicalization. The
      // existing API returns the same registered project instead of guessing
      // by project name or accidentally counting a worktree as a new project.
      let resolution = projectResolutions.get(key);
      if (!resolution) {
        resolution = ipc
          .agentAddProject(service.name, service.cwd)
          .then((project) => project.id)
          .catch(() => {
            projectResolutions.delete(key);
            return undefined;
          });
        projectResolutions.set(key, resolution);
      }
      void resolution.then((projectId) => {
        if (!disposed && projectId)
          setResolved((previous) =>
            previous[key] === projectId ? previous : { ...previous, [key]: projectId },
          );
      });
    }
    return () => {
      disposed = true;
    };
  }, [services, projects, ready, resolved]);
  const activity = useMemo(
    () => buildSidebarAgentActivity(projects, services, sessions, resolved),
    [projects, services, sessions, resolved],
  );
  return (
    <SidebarAgentActivityContext.Provider value={activity}>
      {children}
    </SidebarAgentActivityContext.Provider>
  );
}

function openAgentActivity(activity: AgentActivitySummary) {
  if (activity.targetSessionId) openAgentTask(activity.targetSessionId);
  else openAgentView('overview', activity.targetProjectId ?? '');
}

export function SidebarAgentActivity({
  serviceIds,
  name,
  compact,
  className,
}: {
  serviceIds?: string[];
  name: string;
  compact?: boolean;
  className?: string;
}) {
  i18n.useLocale();
  const activity = useSidebarAgentActivity(serviceIds);
  if (!activity) return null;
  return (
    <AgentActivityBadge
      activity={activity}
      name={name}
      compact={compact}
      className={className}
      onClick={() => openAgentActivity(activity)}
    />
  );
}
