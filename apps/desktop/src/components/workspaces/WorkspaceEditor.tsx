import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import type { AgentProject } from '@runhq/cockpit-types';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { useAppStore } from '@/store/useAppStore';
import { useAgentStore } from '@/store/useAgentStore';
import { ipc } from '@/lib/ipc';
import { showSidebarSections } from '@/components/sidebar/sectionNavigation';
import { openAgentView } from '@/lib/workbenchNavigation';

export function WorkspaceEditor({
  sectionId,
  project,
  onClose,
}: {
  sectionId: string;
  project?: AgentProject;
  onClose: () => void;
}) {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const stacks = useAppStore((s) => s.stacks);
  const serviceSection = useAppStore((s) => s.serviceSection);
  const stackSection = useAppStore((s) => s.stackSection);
  const section = useAppStore((s) => s.sections.find((entry) => entry.id === sectionId));
  const candidates = services.filter(
    (service) =>
      serviceSection[service.id] === sectionId ||
      (!serviceSection[service.id] &&
        stacks.some(
          (stack) => stackSection[stack.id] === sectionId && stack.service_ids.includes(service.id),
        )) ||
      project?.workspace?.members.some((member) => member.service_id === service.id),
  );
  const [name, setName] = useState(project?.name ?? section?.name ?? '');
  const [instructions, setInstructions] = useState(project?.workspace?.instructions ?? '');
  const [root, setRoot] = useState(project?.path ?? '');
  const [selected, setSelected] = useState(
    project?.workspace?.members.map((member) => member.service_id) ??
      candidates.map((service) => service.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = selected.filter((id) => !services.some((service) => service.id === id));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await ipc.agentSaveMultiWorkspace({
        id: project?.id,
        name: name.trim(),
        root: root.trim(),
        sectionId,
        serviceIds: selected,
        instructions,
      });
      await useAgentStore.getState().refresh(true);
      useAgentStore.setState((state) => ({
        projects: [...state.projects.filter((entry) => entry.id !== result.id), result],
      }));
      showSidebarSections(sectionId);
      openAgentView('overview', result.id);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <Dialog
      title={project ? i18n.t('Edit workspace') : i18n.t('New workspace')}
      subtitle={section?.name}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button disabled={saving} onClick={onClose}>
            {i18n.t('Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || !selected.length || !!missing.length}
            onClick={() => void save()}
          >
            {saving ? i18n.t('Saving…') : project ? i18n.t('Save') : i18n.t('Create workspace')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-fg-muted text-[12px]">
          {i18n.t('Select the services that agents in this workspace can work on together.')}
        </p>
        <Field label={i18n.t('Workspace name')}>
          <Input
            autoFocus
            aria-label={i18n.t('Workspace name')}
            value={name}
            maxLength={200}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <fieldset disabled={saving} className="border-border rounded-lg border p-3">
          <legend className="text-fg-muted px-1 text-[11px]">{i18n.t('Included projects')}</legend>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {candidates.map((service) => (
              <label
                key={service.id}
                className="hover:bg-fg/5 flex cursor-pointer items-center gap-3 rounded-md p-2"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={selected.includes(service.id)}
                  onChange={() =>
                    setSelected((ids) =>
                      ids.includes(service.id)
                        ? ids.filter((id) => id !== service.id)
                        : [...ids, service.id],
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="text-fg block text-[12px]">{service.name}</span>
                  <span className="text-fg-dim block truncate text-[10px]" title={service.cwd}>
                    {service.cwd}
                  </span>
                </span>
              </label>
            ))}
            {missing.map((id) => (
              <label key={id} className="text-status-error flex items-center gap-3 p-2 text-[12px]">
                <input
                  type="checkbox"
                  checked
                  onChange={() => setSelected((ids) => ids.filter((entry) => entry !== id))}
                />
                {i18n.t('Unavailable service: {name}', {
                  name:
                    project?.workspace?.members.find((member) => member.service_id === id)?.name ??
                    id,
                })}
              </label>
            ))}
            {!candidates.length && !missing.length && (
              <p className="text-fg-dim text-[12px]">
                {i18n.t('No services available in this section.')}
              </p>
            )}
          </div>
        </fieldset>
        <Field
          label={i18n.t('Shared root folder')}
          hint={i18n.t(
            'Agents start in the shared root folder. All selected folders must be inside it.',
          )}
        >
          <div className="flex gap-2">
            <Input
              aria-label={i18n.t('Shared root folder')}
              value={root}
              disabled={saving}
              onChange={(event) => setRoot(event.target.value)}
              placeholder={i18n.t('Choose automatically from selected projects')}
            />
            <Button
              disabled={saving}
              aria-label={i18n.t('Choose a shared root folder')}
              onClick={() =>
                void open({
                  directory: true,
                  multiple: false,
                  title: i18n.t('Choose a shared root folder'),
                })
                  .then((path) => {
                    if (typeof path === 'string') setRoot(path);
                  })
                  .catch((reason) => setError(String(reason)))
              }
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </Field>
        <Field
          label={i18n.t('Shared instructions')}
          hint={i18n.t(
            'Instructions for every new task in this workspace. Existing tasks keep their original instructions.',
          )}
        >
          <Textarea
            aria-label={i18n.t('Shared instructions')}
            value={instructions}
            maxLength={8000}
            rows={4}
            disabled={saving}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={i18n.t(
              'For example: When changing an API, update its frontend client and run both test suites.',
            )}
          />
        </Field>
        <p className="text-fg-dim text-[11px]">
          {i18n.t('Workspaces use local project folders. Isolated worktrees are unavailable.')}
        </p>
        {project && (
          <p className="text-fg-dim text-[11px]">
            {i18n.t(
              'Changes apply to new tasks. Existing tasks keep their original project selection.',
            )}
          </p>
        )}
        {error && (
          <div role="alert" className="text-status-error text-[12px]">
            <p>{i18n.t('Could not save the workspace.')}</p>
            <p className="mt-1 break-words">{error}</p>
          </div>
        )}
      </div>
    </Dialog>,
    document.body,
  );
}
