import * as i18n from '@runhq/cockpit-ui/i18n';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, SlidersHorizontal } from 'lucide-react';
import type { AgentProject } from '@runhq/cockpit-types';
import { useAppStore } from '@/store/useAppStore';
import { ipc } from '@/lib/ipc';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { workspaceRunPlanValid, workspaceStackId } from './workspaceModel';

export function WorkspaceRunGroup({ project }: { project: AgentProject }) {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const stack = useAppStore((s) =>
    s.stacks.find((entry) => entry.id === workspaceStackId(project.id)),
  );
  const statuses = useAppStore((s) => s.statuses);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !!stack && workspaceRunPlanValid(project, stack, services);
  const commands =
    stack?.service_ids.flatMap((id) =>
      (
        stack.command_names?.[id] ??
        services.find((service) => service.id === id)?.cmds.map((command) => command.name) ??
        []
      ).map((name) => ({ id, name })),
    ) ?? [];
  const running = commands.filter(({ id, name }) =>
    statuses[id]?.commands.some(
      (command) =>
        command.name === name && ['running', 'starting', 'stopping'].includes(command.status),
    ),
  ).length;
  const run = async (stop: boolean) => {
    if (!stack || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.agentRunMultiWorkspace(project.id, stop);
      if (result.errors?.length) setError(result.errors.join('\n'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="border-border bg-surface-raised/30 rounded-xl border p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-fg text-[13px] font-semibold">{i18n.t('Run commands')}</h2>
        <Button
          size="sm"
          disabled={busy || running > 0}
          onClick={() => setEditing(true)}
          leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
        >
          {i18n.t('Configure run group')}
        </Button>
      </div>
      {stack ? (
        <>
          <div className="text-fg-muted mb-3 space-y-1 text-[12px]">
            {commands.map(({ id, name }) => (
              <div key={`${id}:${name}`} className="flex items-center justify-between gap-3">
                <span>{services.find((service) => service.id === id)?.name ?? id}</span>
                <code className="text-fg-dim truncate">{name}</code>
              </div>
            ))}
          </div>
          <p className="text-fg-dim mb-3 text-[11px]">
            {i18n.t('Running commands')}: {i18n.number(running)} / {i18n.number(commands.length)}
          </p>
          {!valid && (
            <p className="text-status-warning mb-3 text-[12px]">
              {i18n.t(
                'The run group contains unavailable projects or commands. Update its configuration.',
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy || !valid || running === commands.length}
              onClick={() => void run(false)}
              leftIcon={<Play className="h-3.5 w-3.5" />}
            >
              {i18n.t('Start workspace')}
            </Button>
            <Button
              disabled={busy || !running}
              onClick={() => void run(true)}
              leftIcon={<Square className="h-3.5 w-3.5" />}
            >
              {i18n.t('Stop workspace')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => useAppStore.getState().setSelectedStack(stack.id)}
            >
              {i18n.t('Open run group')}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-fg-dim text-[12px]">
          {i18n.t('Configure commands before starting this workspace.')}
        </p>
      )}
      {error && (
        <div role="alert" className="text-status-error mt-3 text-[12px]">
          <p>{i18n.t('Could not run workspace commands.')}</p>
          <pre className="whitespace-pre-wrap">{error}</pre>
        </div>
      )}
      {editing && <WorkspaceRunEditor project={project} onClose={() => setEditing(false)} />}
    </section>
  );
}

function WorkspaceRunEditor({ project, onClose }: { project: AgentProject; onClose: () => void }) {
  i18n.useLocale();
  const services = useAppStore((s) => s.services);
  const existing = useAppStore((s) =>
    s.stacks.find((stack) => stack.id === workspaceStackId(project.id)),
  );
  const candidates = services.filter((service) =>
    project.workspace?.members.some((member) => member.service_id === service.id),
  );
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      candidates.map((service) => [
        service.id,
        existing?.service_ids.includes(service.id)
          ? (existing.command_names?.[service.id] ?? service.cmds.map((command) => command.name))
          : [],
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serviceIds = candidates
    .filter((service) =>
      selected[service.id]?.some((name) => service.cmds.some((command) => command.name === name)),
    )
    .map((service) => service.id);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const stack = await ipc.updateStack({
        id: workspaceStackId(project.id),
        name: existing?.name ?? i18n.t('{name} · Run', { name: project.name }),
        service_ids: serviceIds,
        command_names: Object.fromEntries(
          serviceIds.map((id) => [
            id,
            selected[id]!.filter((name) =>
              candidates
                .find((service) => service.id === id)!
                .cmds.some((command) => command.name === name),
            ),
          ]),
        ),
        auto_start: existing?.auto_start ?? false,
      });
      useAppStore.getState().upsertStack(stack);
      if (!existing && project.workspace?.section_id)
        useAppStore.getState().assignStackToSection(stack.id, project.workspace.section_id);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <Dialog
      title={i18n.t('Configure run group')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>
            {i18n.t('Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !serviceIds.length}
            onClick={() => void save()}
          >
            {busy ? i18n.t('Saving…') : i18n.t('Save')}
          </Button>
        </div>
      }
    >
      <p className="text-fg-muted mb-4 text-[12px]">
        {i18n.t('Choose commands to start and stop together. This group is saved as a Stack.')}
      </p>
      <div className="space-y-4">
        {candidates.map((service) => (
          <fieldset
            key={service.id}
            disabled={busy}
            className="border-border rounded-lg border p-3"
          >
            <legend className="text-fg px-1 text-[12px]">{service.name}</legend>
            {service.cmds.map((command) => (
              <label
                key={command.name}
                className="hover:bg-fg/5 flex cursor-pointer items-center gap-3 rounded p-2"
              >
                <input
                  type="checkbox"
                  checked={selected[service.id]?.includes(command.name) ?? false}
                  onChange={() =>
                    setSelected((all) => ({
                      ...all,
                      [service.id]: all[service.id]?.includes(command.name)
                        ? all[service.id]!.filter((name) => name !== command.name)
                        : [...(all[service.id] ?? []), command.name],
                    }))
                  }
                />
                <span className="min-w-0 text-[12px]">
                  <span className="text-fg block">{command.name}</span>
                  <code className="text-fg-dim block truncate" title={command.cmd}>
                    {command.cmd}
                  </code>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-status-error mt-3 text-[12px]">
          {i18n.t('Could not save the run group.')} {error}
        </p>
      )}
    </Dialog>,
    document.body,
  );
}
