import * as i18n from '@runhq/cockpit-ui/i18n';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentProject } from '@runhq/cockpit-types';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import { AgentWorkspace } from './AgentWorkspace';

export function ProjectAgentsTab({
  cwd,
  name,
  visible,
}: {
  cwd: string;
  name: string;
  visible: boolean;
}) {
  i18n.useLocale();
  const [project, setProject] = useState<AgentProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setError(null);
    // Resolve through the backend: canonical paths also cover symlinked service directories.
    void ipc
      .agentAddProject(name, cwd)
      .then((result) => {
        if (disposed) return;
        useAgentStore.setState((state) => ({
          projects: [...state.projects.filter((p) => p.id !== result.id), result],
        }));
        setProject(result);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [cwd, name, attempt]);
  if (error)
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
  return <AgentWorkspace key={project.id} project={project} visible={visible} />;
}
