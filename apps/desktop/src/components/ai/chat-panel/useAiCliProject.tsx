import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect } from '@runhq/cockpit-ui';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Plus } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { useAgentStore } from '@/store/useAgentStore';
import type { ServiceDef } from '@/types';

export function useAiCliProject(
  enabled: boolean,
  service: ServiceDef | null | undefined,
  onError: (message: string) => void,
) {
  const projects = useAgentStore((state) => state.projects);
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (enabled) void useAgentStore.getState().refresh();
  }, [enabled]);

  const resolveProject = useCallback(async () => {
    if (service) return (await ipc.agentAddProject(service.name, service.cwd)).id;
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error('Choose a project folder below before sending to a CLI tool.');
    return project.id;
  }, [service, projects, projectId]);

  const addProject = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: 'Choose a project for AI Chat',
      });
      if (!path || Array.isArray(path)) return;
      const project = await ipc.agentAddProject('', path);
      await useAgentStore.getState().refresh(true);
      setProjectId(project.id);
    } catch (error) {
      onError(String(error));
    }
  };

  const projectControl =
    enabled && !service ? (
      <div className="text-fg-dim mb-2 flex items-center gap-1.5 text-[11px]">
        <FolderOpen className="h-3 w-3 shrink-0" />
        <SearchableSelect
          label="CLI project folder"
          compact
          className="min-w-0 flex-1"
          placeholder="Choose a project…"
          value={projectId}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
            description: project.path,
          }))}
          onChange={setProjectId}
          searchPlaceholder="Find a project…"
        />
        <button
          type="button"
          onClick={() => void addProject()}
          aria-label="Choose another project folder"
          title="Choose another folder"
          className="hover:bg-fg/5 hover:text-fg rounded p-1"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : undefined;

  return { resolveProject, projectControl };
}
