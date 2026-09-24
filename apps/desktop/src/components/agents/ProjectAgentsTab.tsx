import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentProject } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { useAppStore } from '@/store/useAppStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { AgentWorkspace } from './AgentWorkspace';

export function ProjectAgentsTab({
  cwd,
  name,
  visible,
  serviceId,
}: {
  cwd: string;
  name: string;
  visible: boolean;
  serviceId?: string;
}) {
  i18n.useLocale();
  const [resolved, setResolved] = useState<{
    cwd: string;
    name: string;
    attempt: number;
    project: AgentProject;
  } | null>(null);
  const [failure, setFailure] = useState<{ cwd: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A service can change directories without this host unmounting. Never display the previous
  // directory's tasks while its replacement is resolving; a name-only edit keeps the same host.
  const project = resolved?.cwd === cwd ? resolved.project : null;
  const error = failure?.cwd === cwd ? failure.message : null;
  useEffect(() => {
    if (!visible) return;
    if (resolved?.cwd === cwd && resolved.name === name && resolved.attempt === attempt) return;
    let disposed = false;
    setFailure(null);
    // Resolve through the backend: canonical paths also cover symlinked service directories.
    void ipc
      .agentAddProject(name, cwd)
      .then((result) => {
        if (disposed) return;
        useAgentStore.setState((state) => ({
          projects: [...state.projects.filter((p) => p.id !== result.id), result],
        }));
        for (const service of useAppStore.getState().services) {
          if (service.cwd !== cwd || (serviceId && service.id !== serviceId)) continue;
          useWorkbenchStore.getState().registerServiceAgentProject(service.id, cwd, result);
        }
        setResolved({ cwd, name, attempt, project: result });
      })
      .catch((e) => {
        if (!disposed) setFailure({ cwd, message: String(e) });
      });
    return () => {
      disposed = true;
    };
  }, [cwd, name, attempt, visible, resolved, serviceId]);
  if (error && !project)
    return (
      <div
        role="alert"
        className="text-status-error flex flex-1 flex-col items-center justify-center gap-3 p-6 text-[13px]"
      >
        <p>{error}</p>
        <button
          className="border-border text-fg rounded-md border px-3 py-2"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {i18n.t('Retry loading project sessions')}
        </button>
      </div>
    );
  if (!project)
    return (
      <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 text-[13px]">
        {i18n.rich('{value1}Loading project sessions…', {
          value1: <Loader2 className="h-4 w-4 animate-spin" />,
        })}
      </div>
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error && (
        <div
          role="alert"
          className="text-status-error border-border flex items-center gap-3 border-b px-4 py-2 text-[12px]"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button className="shrink-0 underline" onClick={() => setAttempt((value) => value + 1)}>
            {i18n.t('Retry loading project sessions')}
          </button>
        </div>
      )}
      <AgentWorkspace key={project.id} project={project} shell visible={visible} />
    </div>
  );
}
