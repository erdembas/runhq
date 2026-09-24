import * as i18n from '@runhq/cockpit-ui/i18n';
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
  purpose: 'chat' | 'catalog' = 'chat',
) {
  i18n.useLocale();
  const projects = useAgentStore((state) => state.projects);
  const [projectId, setProjectId] = useState('');
  const [serviceProject, setServiceProject] = useState<{
    serviceId: string;
    projectId: string;
  } | null>(null);
  const selectedProject = projects.find((entry) => entry.id === projectId) ?? projects[0];
  const catalogProjectId = service
    ? serviceProject?.serviceId === service.id
      ? serviceProject.projectId
      : ''
    : (selectedProject?.id ?? '');
  const serviceId = service?.id;
  const serviceName = service?.name;
  const servicePath = service?.cwd;
  useEffect(() => {
    if (enabled) void useAgentStore.getState().refresh();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !serviceId || !servicePath) return;
    let cancelled = false;
    void ipc
      .agentAddProject(serviceName ?? '', servicePath)
      .then((project) => {
        if (!cancelled) setServiceProject({ serviceId, projectId: project.id });
      })
      .catch((error) => {
        if (!cancelled) onError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, serviceId, serviceName, servicePath, onError]);

  const resolveProject = useCallback(async () => {
    if (service) return (await ipc.agentAddProject(service.name, service.cwd)).id;
    const project = selectedProject;
    if (!project)
      throw new Error(i18n.t('Choose a project folder below before sending to a CLI tool.'));
    return project.id;
  }, [service, selectedProject]);

  const addProject = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title:
          purpose === 'catalog'
            ? i18n.t('Choose a project for model discovery')
            : i18n.t('Choose a project for AI Chat'),
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
          label={
            purpose === 'catalog' ? i18n.t('Model catalog project') : i18n.t('CLI project folder')
          }
          compact
          className="min-w-0 flex-1"
          placeholder={i18n.t('Choose a project…')}
          value={selectedProject?.id ?? ''}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
            description: project.path,
          }))}
          onChange={setProjectId}
          searchPlaceholder={i18n.t('Find a project…')}
        />
        <button
          type="button"
          onClick={() => void addProject()}
          aria-label={i18n.t('Choose another project folder')}
          title={i18n.t('Choose another folder')}
          className="hover:bg-fg/5 hover:text-fg rounded p-1"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : undefined;

  return { resolveProject, projectControl, catalogProjectId };
}
