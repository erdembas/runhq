import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { Folders, Pencil, Trash2 } from 'lucide-react';
import type { AgentProject } from '@runhq/cockpit-types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAgentStore } from '@/store/useAgentStore';
import { useAppStore } from '@/store/useAppStore';
import { openAgentView } from '@/lib/workbenchNavigation';
import { ipc } from '@/lib/ipc';
import { WorkspaceEditor } from './WorkspaceEditor';

/** Empty sectionId collects workspaces whose visual section has been removed. */
export function SectionWorkspaces({ sectionId }: { sectionId: string }) {
  i18n.useLocale();
  const projects = useAgentStore((s) => s.projects);
  const selected = useAgentStore((s) => s.projectFilter);
  const activeTab = useAppStore((s) => s.activeMainTabKey);
  const sections = useAppStore((s) => s.sections);
  const search = useAppStore((s) => s.search).trim();
  const [editing, setEditing] = useState<AgentProject | null>(null);
  const [removing, setRemoving] = useState<AgentProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workspaces = projects.filter(
    (project) =>
      project.workspace &&
      (sectionId
        ? project.workspace.section_id === sectionId
        : !sections.some((section) => section.id === project.workspace?.section_id)) &&
      (!search ||
        `${project.name} ${project.path}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
  );
  const remove = async (project: AgentProject) => {
    setRemoving(null);
    setError(null);
    try {
      await ipc.agentDeleteMultiWorkspace(project.id);
      await useAgentStore.getState().refresh(true);
      useAgentStore.setState((state) => ({
        projects: state.projects.filter((entry) => entry.id !== project.id),
      }));
      if (useAgentStore.getState().projectFilter === project.id) openAgentView('conversations', '');
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <>
      {workspaces.map((project) => (
        <div
          key={project.id}
          className={`group mx-2 my-1 flex items-center rounded-lg ${selected === project.id && activeTab === 'agents:agents' ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-fg/5'}`}
        >
          <button
            type="button"
            onClick={() => openAgentView('overview', project.id)}
            title={project.path}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-[12px]"
          >
            <Folders className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-fg-dim text-[10px]">
              {i18n.number(project.workspace!.members.length)}
            </span>
          </button>
          <button
            type="button"
            aria-label={i18n.t('Edit workspace')}
            title={i18n.t('Edit workspace')}
            onClick={() => setEditing(project)}
            className="hover:text-fg rounded p-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={i18n.t('Delete workspace')}
            title={i18n.t('Delete workspace')}
            onClick={() => setRemoving(project)}
            className="hover:text-status-error mr-1 rounded p-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      {editing && (
        <WorkspaceEditor sectionId={sectionId} project={editing} onClose={() => setEditing(null)} />
      )}
      {removing && (
        <ConfirmDialog
          message={i18n.t(
            'Delete workspace "{name}"? Projects and existing tasks will be preserved.',
            { name: removing.name },
          )}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
      {error && (
        <p role="alert" className="text-status-error px-4 py-2 text-[11px]">
          {i18n.t('Could not delete the workspace.')} {error}
        </p>
      )}
    </>
  );
}
